/**
 * Scheduler tests — hermetic, with a virtual clock, fake timers, a fake
 * trigger-actions source, and a fake dispatcher (no real `setTimeout`, no DB, no
 * SceneEngine/DeviceManager — those are the TriggerActionDispatcher's concern).
 * We control time explicitly and advance it to fire timers, then assert: jobs
 * are armed with the right next-run, firing dispatches the job's wired trigger
 * actions with `source: "scheduler"` and re-arms the following occurrence, a job
 * with no wired actions yet still re-arms without dispatching, disabled jobs are
 * skipped, and the dynamic add/remove/reload API tracks state.
 *
 * `dispatchActions` awaits the trigger-actions repo before calling the
 * dispatcher, so — unlike the old single-microtask-deep fake SceneEngine call —
 * the fire-and-forget chain is a few microtasks deep. `advanceTo` flushes with a
 * real macrotask tick (`setTimeout(…, 0)`) rather than a single
 * `await Promise.resolve()`, since the JS event loop always fully drains the
 * microtask queue before running the next macrotask, regardless of chain depth.
 */

import { describe, expect, test } from "bun:test";
import type { TriggerAction } from "@gallery/types";
import { Scheduler, type ScheduledJobRecord } from "../../src/core/Scheduler.ts";
import { logger } from "../../src/logger.ts";

const T0 = Date.parse("2026-06-21T10:07:00Z"); // a fixed reference instant

/** Virtual clock + in-memory timer wheel driving the Scheduler. */
function makeClock(start = T0) {
  let nowMs = start;
  let nextId = 1;
  const timers = new Map<number, { fireAt: number; cb: () => void }>();
  return {
    now: () => nowMs,
    setTimer: (cb: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { fireAt: nowMs + ms, cb });
      return id;
    },
    clearTimer: (h: unknown) => void timers.delete(h as number),
    pending: () => timers.size,
    /** Advance virtual time to `target`, firing due timers (and any they re-arm). */
    async advanceTo(target: number) {
      for (;;) {
        let pick: { id: number; fireAt: number; cb: () => void } | undefined;
        for (const [id, t] of timers) {
          if (t.fireAt <= target && (!pick || t.fireAt < pick.fireAt)) pick = { id, ...t };
        }
        if (!pick) break;
        nowMs = pick.fireAt;
        timers.delete(pick.id);
        pick.cb();
        // Flush the fire-and-forget dispatch chain (a few microtasks deep — see
        // file header) before checking for the next due timer.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      nowMs = target;
    },
  };
}

/** Build a TriggerAction row wired to a schedule, with sensible defaults. */
function triggerAction(partial: Partial<TriggerAction> = {}): TriggerAction {
  return {
    id: partial.id ?? crypto.randomUUID(),
    scheduleId: partial.scheduleId ?? null,
    mappingId: partial.mappingId ?? null,
    targetType: partial.targetType ?? "scene.execute",
    targetId: partial.targetId ?? "s1",
    targetCommand: partial.targetCommand ?? null,
    params: partial.params ?? {},
    createdAt: partial.createdAt ?? new Date(),
    updatedAt: partial.updatedAt ?? new Date(),
  };
}

/** Fake trigger-actions source keyed by scheduleId (mutable so tests can rewire). */
function makeTriggerActionsSource(byJob: Record<string, TriggerAction[]> = {}) {
  return {
    byJob,
    async listByScheduleId(scheduleId: string) {
      return byJob[scheduleId] ?? [];
    },
  };
}

/** Fake dispatcher recording calls synchronously up to its own await boundary. */
function makeDispatcher() {
  const calls: Array<{ actionIds: string[]; source: string; sourceDetail: string }> = [];
  return {
    calls,
    async dispatchAll(actions: readonly TriggerAction[], source: string, sourceDetail: string) {
      calls.push({ actionIds: actions.map((a) => a.id), source, sourceDetail });
      return actions.map((a) => ({ triggerActionId: a.id, targetType: a.targetType, ok: true }));
    },
  };
}

/** Fake jobs repo capturing the Scheduler's write-backs. */
function makeJobsRepo(jobs: ScheduledJobRecord[]) {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const nextRunAt = new Map<string, Date | null>();
  const lastRunAt = new Map<string, Date>();
  return {
    byId,
    nextRunAt,
    lastRunAt,
    async listEnabled() {
      return jobs.filter((j) => j.enabled);
    },
    async get(id: string) {
      return byId.get(id);
    },
    async setNextRunAt(id: string, d: Date | null) {
      nextRunAt.set(id, d);
    },
    async setLastRunAt(id: string, d: Date) {
      lastRunAt.set(id, d);
    },
  };
}

function job(p: Partial<ScheduledJobRecord> = {}): ScheduledJobRecord {
  return {
    id: "j1",
    name: "Job 1",
    cron: "*/15 * * * *", // every 15 minutes
    timezone: "UTC",
    enabled: true,
    ...p,
  };
}

function makeScheduler(jobs: ScheduledJobRecord[], actionsByJob: Record<string, TriggerAction[]> = {}) {
  const clock = makeClock();
  const triggerActions = makeTriggerActionsSource(actionsByJob);
  const dispatcher = makeDispatcher();
  const repo = makeJobsRepo(jobs);
  const scheduler = new Scheduler({
    jobs: repo,
    triggerActions,
    dispatcher,
    logger,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { scheduler, clock, dispatcher, triggerActions, repo };
}

describe("Scheduler — startup", () => {
  test("arms one timer per enabled job and persists next_run_at", async () => {
    const { scheduler, clock, repo } = makeScheduler([
      job({ id: "j1", enabled: true }),
      job({ id: "j2", enabled: false }),
    ]);
    await scheduler.start();

    expect(scheduler.scheduledCount).toBe(1); // only the enabled job
    expect(clock.pending()).toBe(1);
    // next */15 after 10:07 is 10:15Z.
    expect(repo.nextRunAt.get("j1")?.toISOString()).toBe("2026-06-21T10:15:00.000Z");
    expect(repo.nextRunAt.has("j2")).toBe(false);
  });

  test("warns but does not auto-run a missed job (no dispatch on startup)", async () => {
    const missed = job({ id: "j1", nextRunAt: new Date(T0 - 3_600_000) }); // 1h overdue
    const { scheduler, dispatcher } = makeScheduler([missed], { j1: [triggerAction({ scheduleId: "j1" })] });
    await scheduler.start();

    expect(dispatcher.calls).toHaveLength(0); // missed run is NOT auto-executed
    expect(scheduler.scheduledCount).toBe(1); // but it is re-armed going forward
  });

  test("an invalid cron does not arm a timer and does not throw", async () => {
    const { scheduler, clock } = makeScheduler([job({ cron: "not a cron" })]);
    await scheduler.start();
    expect(scheduler.scheduledCount).toBe(0);
    expect(clock.pending()).toBe(0);
  });
});

describe("Scheduler — firing", () => {
  test("dispatches the job's wired trigger actions with source 'scheduler' and re-arms the next run", async () => {
    const wired = triggerAction({ id: "ta1", scheduleId: "j1", targetId: "s1" });
    const { scheduler, clock, dispatcher, repo } = makeScheduler([job({ id: "j1" })], { j1: [wired] });
    await scheduler.start();

    // Advance to the first fire (10:15Z).
    await clock.advanceTo(Date.parse("2026-06-21T10:15:00Z"));

    expect(dispatcher.calls).toHaveLength(1);
    expect(dispatcher.calls[0]).toEqual({ actionIds: ["ta1"], source: "scheduler", sourceDetail: "scheduler:j1" });
    expect(repo.lastRunAt.get("j1")?.toISOString()).toBe("2026-06-21T10:15:00.000Z");
    // Re-armed for the following occurrence (10:30Z), still exactly one timer.
    expect(scheduler.scheduledCount).toBe(1);
    expect(repo.nextRunAt.get("j1")?.toISOString()).toBe("2026-06-21T10:30:00.000Z");
  });

  test("a job with no wired trigger actions still fires (re-arms, persists last-run) but never dispatches", async () => {
    const { scheduler, clock, dispatcher, repo } = makeScheduler([job({ id: "j1" })]); // no actions wired
    await scheduler.start();

    await clock.advanceTo(Date.parse("2026-06-21T10:15:00Z"));

    expect(dispatcher.calls).toHaveLength(0);
    expect(repo.lastRunAt.get("j1")?.toISOString()).toBe("2026-06-21T10:15:00.000Z");
    expect(scheduler.scheduledCount).toBe(1);
  });

  test("dispatches repeatedly as time advances across multiple occurrences", async () => {
    const { scheduler, clock, dispatcher } = makeScheduler([job()], { j1: [triggerAction({ scheduleId: "j1" })] });
    await scheduler.start();

    await clock.advanceTo(Date.parse("2026-06-21T11:00:00Z")); // 10:15,10:30,10:45,11:00
    expect(dispatcher.calls).toHaveLength(4);
  });
});

describe("Scheduler — dynamic API", () => {
  test("addJob arms an enabled job and ignores a disabled one", async () => {
    const { scheduler } = makeScheduler([]);
    await scheduler.start();
    expect(scheduler.scheduledCount).toBe(0);

    scheduler.addJob(job({ id: "a", enabled: true }));
    scheduler.addJob(job({ id: "b", enabled: false }));
    expect(scheduler.scheduledCount).toBe(1);
  });

  test("removeJob cancels a job's timer", async () => {
    const { scheduler, clock, dispatcher } = makeScheduler([job({ id: "j1" })], {
      j1: [triggerAction({ scheduleId: "j1" })],
    });
    await scheduler.start();
    scheduler.removeJob("j1");
    expect(scheduler.scheduledCount).toBe(0);

    await clock.advanceTo(Date.parse("2026-06-21T11:00:00Z"));
    expect(dispatcher.calls).toHaveLength(0); // never fires after removal
  });

  test("reloadJob arms when enabled and cancels when disabled", async () => {
    const { scheduler, repo } = makeScheduler([job({ id: "j1", enabled: true })]);
    await scheduler.start();
    expect(scheduler.scheduledCount).toBe(1);

    // Flip to disabled in the repo, then reload.
    repo.byId.set("j1", job({ id: "j1", enabled: false }));
    await scheduler.reloadJob("j1");
    expect(scheduler.scheduledCount).toBe(0);

    // Flip back to enabled and reload again.
    repo.byId.set("j1", job({ id: "j1", enabled: true }));
    await scheduler.reloadJob("j1");
    expect(scheduler.scheduledCount).toBe(1);
  });

  test("reloadJob on a missing job cancels any existing timer", async () => {
    const { scheduler, repo } = makeScheduler([job({ id: "j1" })]);
    await scheduler.start();
    repo.byId.delete("j1");
    await scheduler.reloadJob("j1");
    expect(scheduler.scheduledCount).toBe(0);
  });
});

describe("Scheduler — stop", () => {
  test("stop cancels all timers; nothing fires afterwards", async () => {
    const { scheduler, clock, dispatcher } = makeScheduler([job({ id: "j1" }), job({ id: "j2" })], {
      j1: [triggerAction({ scheduleId: "j1" })],
      j2: [triggerAction({ scheduleId: "j2" })],
    });
    await scheduler.start();
    expect(scheduler.scheduledCount).toBe(2);

    scheduler.stop();
    expect(scheduler.scheduledCount).toBe(0);

    await clock.advanceTo(Date.parse("2026-06-21T12:00:00Z"));
    expect(dispatcher.calls).toHaveLength(0);
  });
});
