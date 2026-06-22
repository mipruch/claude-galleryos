/**
 * Scheduler — fires scenes on a cron schedule, timezone-aware.
 *
 * Each enabled `scheduled_jobs` row maps to one pending `setTimeout` aimed at its
 * next UTC fire time (computed from the cron expression in the job's timezone via
 * {@link computeNextRun}). When a timer fires, the scene runs through the injected
 * SceneEngine with `source: "scheduler"`, the run timestamps are persisted, and
 * the *next* occurrence is recomputed and re-armed. Recomputing after every fire
 * is what makes DST transitions correct — the offset is sampled fresh each time
 * rather than assumed constant (see {@link ./cron.ts}).
 *
 * Dynamic at runtime: the schedules REST controller calls {@link reloadJob} /
 * {@link removeJob} after a create/update/toggle/delete so the live timer set
 * tracks the DB without a server restart.
 *
 * Dependencies are injected via narrow interfaces (repo, scene engine, logger)
 * plus an optional clock + timer pair, so the engine is fully testable with fakes
 * and virtual time — no DB, no real `setTimeout`.
 */

import { errMsg } from "@gallery/driver-core";
import { computeNextRun, CronParseError } from "./cron.ts";
import type { Logger } from "../logger.ts";

/** The slice of a scheduled-job row the Scheduler needs. */
export interface ScheduledJobRecord {
  id: string;
  name: string;
  sceneId: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  /** Last persisted next-run; used only for the startup missed-run check. */
  nextRunAt?: Date | null;
}

/** Persistence the Scheduler writes back to (a narrow view of `scheduledJobsRepo`). */
export interface SchedulerJobsRepo {
  listEnabled(): Promise<ScheduledJobRecord[]>;
  get(id: string): Promise<ScheduledJobRecord | undefined>;
  setNextRunAt(id: string, nextRunAt: Date | null): Promise<unknown>;
  setLastRunAt(id: string, lastRunAt: Date): Promise<unknown>;
}

/** Just the entry point the Scheduler invokes on the SceneEngine. */
export interface SchedulerSceneEngine {
  executeScene(
    sceneId: string,
    source: string,
    opts?: { sourceDetail?: string },
  ): Promise<{ status: string }>;
}

/** Opaque timer handle — `setTimeout`'s return in production, anything in tests. */
type TimerHandle = unknown;

export interface SchedulerOptions {
  jobs: SchedulerJobsRepo;
  sceneEngine: SchedulerSceneEngine;
  logger: Logger;
  /** Injectable clock (epoch ms). Defaults to `Date.now`. */
  now?: () => number;
  /** Injectable timer arming. Defaults to `setTimeout`. */
  setTimer?: (cb: () => void, ms: number) => TimerHandle;
  /** Injectable timer cancellation. Defaults to `clearTimeout`. */
  clearTimer?: (handle: TimerHandle) => void;
}

// `setTimeout` clamps delays above ~24.8 days; longer waits are chunked so a
// far-future schedule (e.g. a yearly cron) still fires accurately.
const MAX_TIMER_MS = 2_147_483_647;

export class Scheduler {
  private readonly log: Logger;
  private readonly now: () => number;
  private readonly setTimer: (cb: () => void, ms: number) => TimerHandle;
  private readonly clearTimer: (handle: TimerHandle) => void;
  private readonly timers = new Map<string, TimerHandle>();
  private started = false;

  constructor(private readonly opts: SchedulerOptions) {
    this.log = opts.logger.child("scheduler");
    this.now = opts.now ?? Date.now;
    this.setTimer = opts.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** Load every enabled job, warn about any missed runs, and arm each timer. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const jobs = await this.opts.jobs.listEnabled();
    for (const job of jobs) {
      this.warnIfMissed(job);
      this.scheduleJob(job);
    }
    this.log.info("Scheduler started", { jobs: jobs.length });
  }

  /** Cancel all pending timers. Safe to call repeatedly. */
  stop(): void {
    for (const handle of this.timers.values()) this.clearTimer(handle);
    this.timers.clear();
    this.started = false;
  }

  /** Number of jobs with a live timer (for diagnostics/tests). */
  get scheduledCount(): number {
    return this.timers.size;
  }

  // ── dynamic API (called by the schedules controller) ─────────

  /** Arm a job (no-op if disabled). Used after a create. */
  addJob(job: ScheduledJobRecord): void {
    if (!job.enabled) return;
    this.scheduleJob(job);
  }

  /** Cancel a job's timer. Used after a delete. */
  removeJob(id: string): void {
    this.cancel(id);
  }

  /**
   * Re-read a job from the repo and re-arm it: schedule it if enabled, otherwise
   * cancel any existing timer. Used after an update or enable/disable toggle.
   */
  async reloadJob(id: string): Promise<void> {
    const job = await this.opts.jobs.get(id);
    if (!job || !job.enabled) {
      this.cancel(id);
      return;
    }
    this.scheduleJob(job);
  }

  // ── internals ────────────────────────────────────────────────

  /** Compute the next fire time, persist it, and arm (or re-arm) the timer. */
  private scheduleJob(job: ScheduledJobRecord): void {
    this.cancel(job.id);

    let next: Date | undefined;
    try {
      next = computeNextRun(job.cron, job.timezone, new Date(this.now()));
    } catch (err) {
      const reason = err instanceof CronParseError ? err.message : errMsg(err);
      this.log.error("invalid schedule; job not armed", { id: job.id, cron: job.cron, error: reason });
      return;
    }
    if (!next) {
      this.log.warn("schedule has no upcoming run; job not armed", { id: job.id, cron: job.cron });
      void this.persistNextRun(job.id, null);
      return;
    }

    void this.persistNextRun(job.id, next);
    const delay = Math.max(0, next.getTime() - this.now());
    this.arm(job, delay, next.getTime());
    this.log.info("job scheduled", {
      id: job.id,
      name: job.name,
      cron: job.cron,
      timezone: job.timezone,
      nextRunAt: next.toISOString(),
    });
  }

  /**
   * Arm the underlying timer, chunking waits longer than `setTimeout` can hold.
   * On a chunked wait we simply re-evaluate the remaining time when the chunk
   * elapses; the actual fire only happens once the full delay is reached.
   */
  private arm(job: ScheduledJobRecord, delay: number, targetMs: number): void {
    if (delay > MAX_TIMER_MS) {
      const handle = this.setTimer(() => {
        const remaining = Math.max(0, targetMs - this.now());
        this.arm(job, remaining, targetMs);
      }, MAX_TIMER_MS);
      this.timers.set(job.id, handle);
      return;
    }
    const handle = this.setTimer(() => this.onFire(job), delay);
    this.timers.set(job.id, handle);
  }

  /**
   * Timer callback: record the fire, kick off the scene (not awaited so a slow or
   * conflicting run never delays rescheduling), then re-arm the next occurrence.
   */
  private onFire(job: ScheduledJobRecord): void {
    this.timers.delete(job.id);
    const firedAt = new Date(this.now());
    this.log.info("scheduled job firing", { id: job.id, name: job.name, sceneId: job.sceneId });

    void this.persistLastRun(job.id, firedAt);
    void this.opts.sceneEngine
      .executeScene(job.sceneId, "scheduler", { sourceDetail: `scheduler:${job.id}` })
      .then((r) => this.log.info("scheduled scene finished", { id: job.id, status: r.status }))
      .catch((err) =>
        this.log.warn("scheduled scene run failed", { id: job.id, sceneId: job.sceneId, error: errMsg(err) }),
      );

    // Re-arm for the following occurrence.
    this.scheduleJob(job);
  }

  /** Compare the persisted next-run against now; warn (don't auto-run) if overdue. */
  private warnIfMissed(job: ScheduledJobRecord): void {
    if (job.nextRunAt && job.nextRunAt.getTime() < this.now()) {
      this.log.warn("missed scheduled run while server was down (not auto-running)", {
        id: job.id,
        name: job.name,
        nextRunAt: job.nextRunAt.toISOString(),
      });
    }
  }

  private cancel(id: string): void {
    const handle = this.timers.get(id);
    if (handle !== undefined) {
      this.clearTimer(handle);
      this.timers.delete(id);
    }
  }

  private async persistNextRun(id: string, next: Date | null): Promise<void> {
    try {
      await this.opts.jobs.setNextRunAt(id, next);
    } catch (err) {
      this.log.warn("failed to persist next_run_at", { id, error: errMsg(err) });
    }
  }

  private async persistLastRun(id: string, at: Date): Promise<void> {
    try {
      await this.opts.jobs.setLastRunAt(id, at);
    } catch (err) {
      this.log.warn("failed to persist last_run_at", { id, error: errMsg(err) });
    }
  }
}
