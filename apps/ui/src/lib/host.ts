/**
 * Host validation shared by the manifest-driven forms.
 *
 * Driver manifests mark their "Host / IP" fields with `format: "host"`, meaning
 * *either* a DNS hostname *or* an IP literal. The subtlety this guards against:
 * a string like `290.290.920.89` is a syntactically valid **hostname** (labels
 * may be all-digits), so a plain hostname check accepts it even though it's a
 * broken IPv4. So: anything that looks like dotted-decimal is held to strict
 * IPv4 octet rules; otherwise we accept a hostname or an IPv6 literal.
 *
 * The server enforces the same contract via an Ajv `host` format
 * (`apps/server/src/api/validation.ts`) — keep the two in sync.
 */

/** RFC 1123 hostname (1–253 chars, dot-separated alphanumeric/hyphen labels). */
const HOSTNAME =
  /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

/** Dotted-decimal shape (4+ numeric labels) — anything matching is treated as an IPv4 attempt. */
const DOTTED_NUMERIC = /^\d+(\.\d+)+$/

/** Dotted-quad with each octet in 0–255 (no leading-zero padding). */
function isIpv4(value: string): boolean {
  const parts = value.split('.')
  return (
    parts.length === 4 &&
    parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255 && (p === '0' || !p.startsWith('0')))
  )
}

/** Presence of a colon ⇒ treat as an IPv6 literal (lenient hex-group check). */
function isIpv6(value: string): boolean {
  if (!value.includes(':')) return false
  if (/:::/.test(value)) return false // never 3+ consecutive colons
  // Accept compressed (`::`) and full forms; not exhaustive but rejects garbage.
  return /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(value) && (value.match(/::/g)?.length ?? 0) <= 1
}

/** True if `value` is a valid hostname or IP literal (see module docs). */
export function isHost(value: string): boolean {
  if (!value) return false
  if (value.includes(':')) return isIpv6(value)
  if (DOTTED_NUMERIC.test(value)) return isIpv4(value)
  return HOSTNAME.test(value)
}
