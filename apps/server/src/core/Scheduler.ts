import cron from 'node-cron';
import type { ScheduledJob } from '@galleryos/types';
import { query } from '../db/index.js';
import { childLogger } from '../logger.js';
import { sceneEngine } from './SceneEngine.js';

const log = childLogger('scheduler');

export class Scheduler {
  private tasks = new Map<string, cron.ScheduledTask>();

  async start(): Promise<void> {
    const r = await query<ScheduledJob>(`SELECT * FROM scheduled_jobs WHERE enabled = TRUE`);
    for (const job of r.rows) this.register(job);
    log.info('Scheduler started', { jobs: r.rowCount });
  }

  stop(): void {
    for (const t of this.tasks.values()) t.stop();
    this.tasks.clear();
  }

  register(job: ScheduledJob): void {
    if (this.tasks.has(job.id)) return;
    if (!cron.validate(job.cron)) {
      log.warn('Invalid cron expression, skipping', { jobId: job.id, cron: job.cron });
      return;
    }
    const task = cron.schedule(
      job.cron,
      async () => {
        log.info('Cron job firing', { jobId: job.id, sceneId: job.scene_id });
        try {
          await sceneEngine.executeScene(job.scene_id, {
            source: 'scheduler',
            sourceDetail: `scheduler:${job.id}`,
          });
          await query(
            `UPDATE scheduled_jobs SET last_run_at = NOW() WHERE id = $1`,
            [job.id]
          );
        } catch (err) {
          log.warn('Scheduled execution failed', {
            jobId: job.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
      { timezone: job.timezone }
    );
    this.tasks.set(job.id, task);
  }

  unregister(jobId: string): void {
    const task = this.tasks.get(jobId);
    if (task) {
      task.stop();
      this.tasks.delete(jobId);
    }
  }

  reload(job: ScheduledJob): void {
    this.unregister(job.id);
    if (job.enabled) this.register(job);
  }
}

export const scheduler = new Scheduler();
