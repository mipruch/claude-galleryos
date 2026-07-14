/**
 * Pure address pattern matching for input mappings.
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
 * Captured path params (and the signal's positional args) feed a matched
 * mapping's trigger actions via the template tokens described in
 * {@link ../core/templating.ts}.
 */

/** One compiled pattern segment. */
type PatternSegment = { kind: "literal"; value: string } | { kind: "param"; name: string };

/** A pattern compiled once at cache-load time. */
export interface CompiledPattern {
  /** The exact string to compare when the pattern has no `:param` segments. */
  exact: string | null;
  segments: PatternSegment[];
}

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
