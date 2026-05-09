import { randomUUID } from 'crypto';
import type { Scene, SceneAction } from '@galleryos/types';
import { query } from '../db/index.js';
import { redis } from '../redis.js';
import { childLogger } from '../logger.js';
import { eventBus } from './EventBus.js';
import { deviceManager } from './DeviceManager.js';

const log = childLogger('scene_engine');

interface ExecuteOptions {
  source: string;
  sourceDetail?: string;
  dryRun?: boolean;
}

interface ExecutionResult {
  executionId: string;
  status: 'completed' | 'failed' | 'aborted';
  durationMs: number;
  error?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SceneEngine {
  async executeScene(sceneId: string, options: ExecuteOptions): Promise<ExecutionResult> {
    const start = Date.now();
    const executionId = randomUUID();

    const sceneRes = await query<Scene>(`SELECT * FROM scenes WHERE id = $1`, [sceneId]);
    const scene = sceneRes.rows[0];
    if (!scene) throw new Error('scene_not_found');
    if (!scene.enabled) throw new Error('scene_disabled');

    const actionsRes = await query<SceneAction>(
      `SELECT * FROM scene_actions WHERE scene_id = $1 ORDER BY parallel_group ASC, step_order ASC`,
      [sceneId]
    );
    const actions = actionsRes.rows;

    const isActive = await redis.get(`scene:${sceneId}:active`);
    if (isActive) throw new Error('scene_already_running');

    eventBus.emit('event', {
      type: 'scene.execute.requested',
      sceneId,
      source: options.source,
      executionId,
    });

    await query(
      `INSERT INTO scene_executions (id, scene_id, status, source, source_detail)
       VALUES ($1, $2, 'running', $3, $4)`,
      [executionId, sceneId, options.source, options.sourceDetail ?? null]
    );

    await redis.set(`scene:${sceneId}:active`, '1', 'EX', 600);
    eventBus.emit('event', {
      type: 'scene.execute.started',
      sceneId,
      executionId,
      source: options.source,
    });

    log.info('Scene started', { sceneId, executionId, source: options.source });

    const groups = new Map<number, SceneAction[]>();
    for (const a of actions) {
      const group = groups.get(a.parallel_group) ?? [];
      group.push(a);
      groups.set(a.parallel_group, group);
    }
    const sortedGroups = [...groups.entries()].sort(([a], [b]) => a - b);

    let status: ExecutionResult['status'] = 'completed';
    let errorMsg: string | undefined;

    outer: for (const [groupIdx, groupActions] of sortedGroups) {
      log.debug('Group start', { sceneId, executionId, groupIdx, n: groupActions.length });
      const settled = await Promise.allSettled(
        groupActions.map((action) => this.runAction(action, options.dryRun ?? false))
      );

      for (let i = 0; i < settled.length; i += 1) {
        const out = settled[i];
        const action = groupActions[i];
        if (out.status === 'rejected' || (out.status === 'fulfilled' && !out.value.success)) {
          const failure = out.status === 'rejected' ? out.reason : out.value.error;
          const msg = failure instanceof Error ? failure.message : String(failure);
          log.warn('Action failed', {
            sceneId,
            executionId,
            actionId: action.id,
            command: action.command,
            error: msg,
          });

          if (action.on_failure === 'abort') {
            status = 'aborted';
            errorMsg = `aborted_at_action:${action.id}:${msg}`;
            break outer;
          }
          if (action.on_failure === 'rollback') {
            status = 'failed';
            errorMsg = `rollback_at_action:${action.id}:${msg}`;
            // Rollback logic: not implemented in MVP — log warning.
            log.warn('Rollback requested but not implemented in MVP', { actionId: action.id });
            break outer;
          }
          // continue: proceed
        }
      }
    }

    const durationMs = Date.now() - start;
    await redis.del(`scene:${sceneId}:active`);
    await query(
      `UPDATE scene_executions
         SET status = $1, completed_at = NOW(), duration_ms = $2, error_message = $3
       WHERE id = $4`,
      [status, durationMs, errorMsg ?? null, executionId]
    );

    if (status === 'completed') {
      eventBus.emit('event', {
        type: 'scene.execute.completed',
        sceneId,
        executionId,
        durationMs,
      });
      log.info('Scene completed', { sceneId, executionId, durationMs });
    } else if (status === 'aborted') {
      eventBus.emit('event', {
        type: 'scene.execute.aborted',
        sceneId,
        executionId,
      });
      log.warn('Scene aborted', { sceneId, executionId, error: errorMsg });
    } else {
      eventBus.emit('event', {
        type: 'scene.execute.failed',
        sceneId,
        executionId,
        error: errorMsg ?? 'unknown',
      });
      log.warn('Scene failed', { sceneId, executionId, error: errorMsg });
    }

    return { executionId, status, durationMs, error: errorMsg };
  }

  private async runAction(action: SceneAction, dryRun: boolean) {
    if (action.delay_ms > 0) await delay(action.delay_ms);
    if (dryRun) {
      log.debug('Dry run action', {
        deviceId: action.device_id,
        command: action.command,
        params: action.params,
      });
      return { success: true, durationMs: 0 };
    }
    return deviceManager.execute(action.device_id, action.command, action.params);
  }
}

export const sceneEngine = new SceneEngine();
