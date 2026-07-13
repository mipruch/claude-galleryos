/**
 * TriggerActionDispatcher — the single place a `trigger_actions` row turns into
 * a real effect (run a scene, or call one device command). Shared by the
 * {@link Scheduler} (cron-fired, literal params) and the {@link InputMapper}
 * (ingress-fired, template-evaluated params via {@link evaluateTemplate}), so a
 * future trigger source (e.g. a device state-change event) only has to produce
 * `TriggerAction` rows plus an optional template context and gets dispatch,
 * logging, and error handling for free.
 *
 * An action with no `targetId` (or, for `device.command`, no `targetCommand`)
 * is unwired — a normal, valid state for a trigger the admin hasn't finished
 * connecting on the canvas yet. Dispatch skips it and reports `ok: false` with
 * an explanatory detail rather than throwing.
 */

import type { CommandResult } from "@gallery/driver-core";
import { errMsg } from "@gallery/driver-core";
import type { TriggerAction, TriggerTargetType } from "@gallery/types";
import type { Logger } from "../logger.ts";
import { evaluateTemplate } from "./templating.ts";

/** Just the entry point the dispatcher invokes on the SceneEngine. */
export interface DispatcherSceneEngine {
  startScene(
    sceneId: string,
    source: string,
    opts?: { sourceDetail?: string },
  ): Promise<{ executionId: string; sceneId: string; status: string }>;
}

/** Just the entry point the dispatcher invokes on the DeviceManager. */
export interface DispatcherDeviceManager {
  execute(deviceId: string, command: string, params: Record<string, unknown>): Promise<CommandResult>;
}

export interface TriggerActionDispatcherOptions {
  sceneEngine: DispatcherSceneEngine;
  deviceManager: DispatcherDeviceManager;
  logger: Logger;
}

/** Outcome of dispatching a single trigger action. */
export interface TriggerDispatchOutcome {
  triggerActionId: string;
  targetType: TriggerTargetType;
  ok: boolean;
  detail?: string;
}

/**
 * The signal context a mapping-owned action's `params` template resolves
 * against. Omitted for schedule-owned actions, whose `params` are used as-is
 * (a cron fire has no signal to template against).
 */
export interface TemplateContext {
  args: readonly unknown[];
  pathParams: Record<string, string>;
}

export class TriggerActionDispatcher {
  private readonly log: Logger;

  constructor(private readonly opts: TriggerActionDispatcherOptions) {
    this.log = opts.logger.child("trigger_dispatcher");
  }

  /** Dispatch every action, continuing past individual failures. */
  async dispatchAll(
    actions: readonly TriggerAction[],
    source: string,
    sourceDetail: string,
    template?: TemplateContext,
  ): Promise<TriggerDispatchOutcome[]> {
    const outcomes: TriggerDispatchOutcome[] = [];
    for (const action of actions) outcomes.push(await this.dispatch(action, source, sourceDetail, template));
    return outcomes;
  }

  /** Resolve and execute a single trigger action. Never throws. */
  async dispatch(
    action: TriggerAction,
    source: string,
    sourceDetail: string,
    template?: TemplateContext,
  ): Promise<TriggerDispatchOutcome> {
    const base = { triggerActionId: action.id, targetType: action.targetType };
    if (!action.targetId) {
      this.log.debug("trigger action not wired to a target; skipping", { triggerActionId: action.id });
      return { ...base, ok: false, detail: "not wired to a target" };
    }

    const params = template
      ? evaluateTemplate(action.params, template.args, template.pathParams)
      : action.params;

    try {
      switch (action.targetType) {
        case "scene.execute": {
          const result = await this.opts.sceneEngine.startScene(action.targetId, source, { sourceDetail });
          this.log.info("trigger action ran scene", {
            triggerActionId: action.id,
            sceneId: action.targetId,
          });
          return { ...base, ok: true, detail: `execution ${result.executionId}` };
        }
        case "device.command": {
          if (!action.targetCommand) {
            return { ...base, ok: false, detail: "device.command action has no targetCommand" };
          }
          const result = await this.opts.deviceManager.execute(action.targetId, action.targetCommand, params);
          this.log[result.success ? "info" : "warn"]("trigger action ran command", {
            triggerActionId: action.id,
            deviceId: action.targetId,
            command: action.targetCommand,
            success: result.success,
          });
          return { ...base, ok: result.success, detail: result.error };
        }
        default: {
          // Exhaustive: a new target type is a compile error here.
          const never: never = action.targetType;
          throw new Error(`unknown target type: ${String(never)}`);
        }
      }
    } catch (err) {
      this.log.warn("trigger action dispatch failed", { triggerActionId: action.id, error: errMsg(err) });
      return { ...base, ok: false, detail: errMsg(err) };
    }
  }
}
