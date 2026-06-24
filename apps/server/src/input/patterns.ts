/**
 * Pure pattern matching + parameter templating for input mappings.
 *
 * Kept separate from {@link InputMapper} (which owns the cache and dispatch) so
 * these functions stay side-effect free and exhaustively unit-testable.
 *
 * Patterns are `/`-delimited paths. A segment that starts with `:` is a named
 * wildcard that captures the corresponding address segment; every other segment
 * must match literally. A pattern with no wildcard is matched by exact equality.
 *
 *   compilePattern("/scene/execute")  → exact match of "/scene/execute"
 *   compilePattern("/dim/:level")      → matches "/dim/0.5", capturing level="0.5"
 *
 * Template values reference the signal via tokens:
 *   "{arg[0]}"  → the 0th positional argument (kept with its original type)
 *   "{:level}"  → the captured path param `level` (coerced from string if numeric/bool)
 *   "hi {arg[0]}" → interpolation: the token is stringified into the surrounding text
 * Any non-token value (a number, boolean, or plain string) passes through unchanged.
 */

/** One compiled pattern segment. */
type PatternSegment = { kind: "literal"; value: string } | { kind: "param"; name: string };

/** A pattern compiled once at cache-load time. */
export interface CompiledPattern {
  /** The exact string to compare when the pattern has no `:param` segments. */
  exact: string | null;
  segments: PatternSegment[];
}

/** Matches a single template token, capturing either an arg index or a param name. */
const TOKEN = /\{(?:arg\[(\d+)\]|:([A-Za-z_][\w-]*))\}/g;
/** The same token, anchored: true only when the whole string is one token. */
const WHOLE_TOKEN = /^\{(?:arg\[(\d+)\]|:([A-Za-z_][\w-]*))\}$/;

/** Pre-compile a mapping pattern into segments (and an exact fast-path). */
export function compilePattern(pattern: string): CompiledPattern {
  const segments: PatternSegment[] = pattern.split("/").map((part) =>
    part.startsWith(":") ? { kind: "param", name: part.slice(1) } : { kind: "literal", value: part },
  );
  const hasParam = segments.some((s) => s.kind === "param");
  return { exact: hasParam ? null : pattern, segments };
}

/**
 * Test an address against a compiled pattern.
 *
 * @returns The captured path params (`{}` when none) if it matches, or `null`.
 */
export function matchPattern(pattern: CompiledPattern, address: string): Record<string, string> | null {
  if (pattern.exact !== null) return pattern.exact === address ? {} : null;

  const parts = address.split("/");
  if (parts.length !== pattern.segments.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.segments.length; i++) {
    const seg = pattern.segments[i]!;
    const part = parts[i]!;
    if (seg.kind === "literal") {
      if (seg.value !== part) return null;
    } else {
      params[seg.name] = part;
    }
  }
  return params;
}

/**
 * Apply a `paramsTemplate` to a matched signal, substituting any reference
 * tokens. Nested objects/arrays are resolved recursively; unresolved references
 * (out-of-range arg, missing path param) drop the key rather than emit `undefined`.
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
