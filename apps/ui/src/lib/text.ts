/** Text helpers shared by the device and scene search (single source of truth). */

/** Lowercase + strip diacritics, so "Sál" matches "sal". */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

/** Split a query into normalized, whitespace-separated terms (AND semantics). */
export function searchTerms(query: string): string[] {
  return normalize(query).split(/\s+/).filter(Boolean)
}

/** True when every term appears somewhere in the (already-normalized) haystack. */
export function matchesAllTerms(haystack: string, terms: string[]): boolean {
  return terms.every((t) => haystack.includes(t))
}
