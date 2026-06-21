/** Text helpers shared by the device and scene search (single source of truth). */

/**
 * Normalizes text by removing case distinctions and diacritical marks.
 *
 * @returns The text converted to lowercase with diacritical marks removed
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

/**
 * Splits a query into normalized, whitespace-separated search terms.
 *
 * @returns An array of normalized query terms with empty strings removed.
 */
export function searchTerms(query: string): string[] {
  return normalize(query).split(/\s+/).filter(Boolean)
}

/**
 * Determines if all terms appear in the haystack.
 *
 * Assumes the haystack and terms are already normalized.
 *
 * @returns `true` if all terms are found in the haystack, `false` otherwise
 */
export function matchesAllTerms(haystack: string, terms: string[]): boolean {
  return terms.every((t) => haystack.includes(t))
}
