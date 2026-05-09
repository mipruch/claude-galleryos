import type { InputMapping } from '@galleryos/types';
import { childLogger } from '../logger.js';
import { query } from '../db/index.js';
import { sceneEngine } from '../core/SceneEngine.js';
import { deviceManager } from '../core/DeviceManager.js';

const log = childLogger('input_mapper');

interface CompiledMapping {
  raw: InputMapping;
  regex: RegExp;
  paramNames: string[];
}

let cache: { osc: CompiledMapping[]; tcp: CompiledMapping[] } = { osc: [], tcp: [] };

function compile(m: InputMapping): CompiledMapping {
  const params: string[] = [];
  // Convert pattern with `:name` to capture groups
  const escaped = m.pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
  const regexSrc = escaped.replace(/:(\w+)/g, (_, n: string) => {
    params.push(n);
    return '([^/]+)';
  });
  return {
    raw: m,
    regex: new RegExp(`^${regexSrc}$`),
    paramNames: params,
  };
}

export async function refreshMappings(): Promise<void> {
  const r = await query<InputMapping>(
    `SELECT * FROM input_mappings WHERE enabled = TRUE`
  );
  cache = { osc: [], tcp: [] };
  for (const m of r.rows) {
    const compiled = compile(m);
    if (m.protocol === 'osc') cache.osc.push(compiled);
    else if (m.protocol === 'tcp') cache.tcp.push(compiled);
  }
  log.info('Input mappings refreshed', { osc: cache.osc.length, tcp: cache.tcp.length });
}

function expandTemplate(
  template: Record<string, unknown>,
  args: unknown[],
  groupParams: Record<string, string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(template)) {
    if (typeof v !== 'string') {
      out[k] = v;
      continue;
    }
    let resolved: string | number | boolean = v;
    const argMatch = v.match(/^\{arg\[(\d+)\]\}$/);
    if (argMatch) {
      resolved = args[Number(argMatch[1])] as any;
    } else {
      const paramMatch = v.match(/^\{(\w+)\}$/);
      if (paramMatch && groupParams[paramMatch[1]] !== undefined) {
        resolved = groupParams[paramMatch[1]];
      }
    }
    out[k] = resolved;
  }
  return out;
}

async function dispatch(
  m: CompiledMapping,
  groups: Record<string, string>,
  args: unknown[],
  protocol: string
): Promise<void> {
  const params = expandTemplate(m.raw.params_template, args, groups);
  switch (m.raw.target_type) {
    case 'scene.execute':
      if (m.raw.target_id) {
        await sceneEngine.executeScene(m.raw.target_id, {
          source: protocol,
          sourceDetail: `${protocol}:${m.raw.pattern}`,
        });
      }
      break;
    case 'device.command':
      if (m.raw.target_id && m.raw.target_command) {
        await deviceManager.execute(m.raw.target_id, m.raw.target_command, params);
      }
      break;
    case 'event.emit':
      log.info('Event emit mapping triggered', { mapping: m.raw.id, params });
      break;
  }
}

export async function dispatchOsc(address: string, args: unknown[]): Promise<void> {
  for (const m of cache.osc) {
    const match = address.match(m.regex);
    if (!match) continue;
    const groups: Record<string, string> = {};
    m.paramNames.forEach((name, i) => {
      groups[name] = match[i + 1];
    });
    try {
      await dispatch(m, groups, args, 'osc');
    } catch (err) {
      log.warn('OSC dispatch error', {
        error: err instanceof Error ? err.message : String(err),
        pattern: m.raw.pattern,
      });
    }
  }
}

export async function dispatchTcp(message: string): Promise<void> {
  for (const m of cache.tcp) {
    const match = message.match(m.regex);
    if (!match) continue;
    const groups: Record<string, string> = {};
    m.paramNames.forEach((name, i) => {
      groups[name] = match[i + 1];
    });
    try {
      await dispatch(m, groups, [message], 'tcp');
    } catch (err) {
      log.warn('TCP dispatch error', {
        error: err instanceof Error ? err.message : String(err),
        pattern: m.raw.pattern,
      });
    }
  }
}
