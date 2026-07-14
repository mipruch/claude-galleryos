/**
 * Template-token substitution for trigger action params. Shared by the
 * {@link InputMapper} (which supplies ingress signal args/path params as the
 * template context) and the {@link TriggerActionDispatcher} (which evaluates a
 * mapping-owned trigger action's `params` against that context at dispatch
 * time). Kept pure and dependency-free so it's exhaustively unit-testable.
 *
 * Template values reference the signal via tokens:
 *   "{arg[0]}"    → the 0th positional argument (kept with its original type)
 *   "{:level}"    → the captured path param `level` (coerced from string if numeric/bool)
 *   "hi {arg[0]}" → interpolation: the token is stringified into the surrounding text
 * Any non-token value (a number, boolean, or plain string) passes through unchanged.
 *
 * Schedule-owned trigger actions never go through this module — a cron fire has
 * no signal to template against, so its `params` are used literally.
 */

/** Matches a single template token, capturing either an arg index or a param name. */
const TOKEN = /\{(?:arg\[(\d+)\]|:([A-Za-z_][\w-]*))\}/g;
/** The same token, anchored: true only when the whole string is one token. */
const WHOLE_TOKEN = /^\{(?:arg\[(\d+)\]|:([A-Za-z_][\w-]*))\}$/;

/**
 * Apply a trigger action's `params` template to a matched signal, substituting
 * any reference tokens. Nested objects/arrays are resolved recursively;
 * unresolved references (out-of-range arg, missing path param) drop the key
 * rather than emit `undefined`.
 */
export function evaluateTemplate(
  template: Record<string, unknown>,
  args: readonly unknown[],
  pathParams: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(template)) {
    const resolved = resolveValue(value, args, pathParams);
    if (resolved !== undefined) out[key] = resolved;
  }
  return out;
}

/** Resolve one template value (recursing into objects/arrays). */
function resolveValue(
  value: unknown,
  args: readonly unknown[],
  pathParams: Record<string, string>,
): unknown {
  if (typeof value === "string") return substitute(value, args, pathParams);
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, args, pathParams));
  if (value !== null && typeof value === "object") {
    return evaluateTemplate(value as Record<string, unknown>, args, pathParams);
  }
  return value; // number | boolean | null
}

/** Substitute tokens in a string value. */
function substitute(str: string, args: readonly unknown[], pathParams: Record<string, string>): unknown {
  // Whole-string token: preserve the referenced value's type.
  const whole = WHOLE_TOKEN.exec(str);
  if (whole) {
    const [, argIdx, paramName] = whole;
    if (argIdx !== undefined) {
      const i = Number(argIdx);
      return i < args.length ? args[i] : undefined;
    }
    const raw = pathParams[paramName!];
    return raw === undefined ? undefined : coerce(raw);
  }

  // Embedded token(s): interpolate as text.
  return str.replace(TOKEN, (_match, argIdx: string | undefined, paramName: string | undefined) => {
    if (argIdx !== undefined) {
      const i = Number(argIdx);
      return i < args.length ? stringify(args[i]) : "";
    }
    return pathParams[paramName!] ?? "";
  });
}

/** Coerce a captured path-param string to a number/boolean when it clearly is one. */
function coerce(s: string): string | number | boolean {
  if (s === "true") return true;
  if (s === "false") return false;
  if (s.trim() !== "" && Number.isFinite(Number(s))) return Number(s);
  return s;
}

/** Stringify a value for interpolation (objects → JSON, primitives → String). */
function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
