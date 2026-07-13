/**
 * Pure helpers for resolving and reading generic device-control widgets.
 *
 * A device's `WidgetBinding[]` comes from its driver manifest's endpoint type
 * (`@gallery/driver-core`) — this is the driver-agnostic replacement for the
 * old `deviceKind()` subtype switch and the five bespoke widget components it
 * fed. The UI ships one small Vue component per `WidgetBinding['kind']` and
 * composes whatever a device's endpoint type declares (see `DeviceWidget.vue`);
 * a new driver needs zero UI code, only manifest entries.
 *
 * Any real translation (inverting a boolean, remembering a value while off,
 * deriving a dynamic option list, …) is deliberately NOT expressible here — it
 * lives in the driver itself (see driver-bss's `bss-soundweb.matrix` endpoint
 * type or driver-dali-*'s brightness preservation). A binding only ever names
 * commands/params/state keys; reading it is a dumb lookup.
 */
import type { SelectWidgetBinding, WidgetBinding } from '@gallery/driver-core'

/**
 * Endpoint types with a bespoke, hand-written widget instead of a generic one —
 * a deliberate, narrow exception (the BSS live-meter panel needs a whole panel
 * of live bars, not a control), not a pattern to grow.
 */
const CUSTOM_WIDGET_TYPES = new Set<string>(['bss-soundweb.meter-widget'])

export function isCustomWidgetType(endpointType: string | null | undefined): boolean {
  return !!endpointType && CUSTOM_WIDGET_TYPES.has(endpointType)
}

/** Whether the UI can render *something* for this endpoint type — generic widgets or a named exception. */
export function isRenderableType(
  endpointType: string | null | undefined,
  widgets: WidgetBinding[],
): boolean {
  return isCustomWidgetType(endpointType) || widgets.length > 0
}

/**
 * Interpret a widget's raw state value as boolean. Tolerates a richer status
 * string some drivers keep (e.g. PJLink's `power: "off"|"on"|"cooling"|"warming"`) —
 * `"on"` and the transitional `"warming"` read as on.
 */
export function readBoolLike(value: unknown): boolean {
  if (value === true) return true
  if (typeof value === 'string') return value === 'on' || value === 'warming'
  return false
}

/** Read a 0..1 numeric level, clamped, defaulting to 0. */
export function readLevel(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** Read a select widget's currently selected value, defaulting to 0. */
export function readSelected(value: unknown): number | string {
  return typeof value === 'number' || typeof value === 'string' ? value : 0
}

/** Composition-level render hints `DeviceWidget.vue` derives for a fader from a sibling power/mute binding, if any. */
export interface FaderRenderHints {
  /** Grey the fader out (a sibling power/mute binding says off/muted). */
  dimmed: boolean
  /** A commit should persist the desired value instead of sending a live command. */
  blockCommit: boolean
}

/**
 * Pairs a fader with a sibling power/mute binding on the same device, if any,
 * so the fader can grey itself out (and, for a power companion whose
 * `gatesFader` isn't explicitly `false`, avoid sending a live command while
 * the device is off). A `mute` companion, or a `power` companion declared
 * with `gatesFader: false` (e.g. a matrix crosspoint's route-enable riding
 * the same always-addressable parameter as its fader), never blocks commit —
 * see `WidgetBinding.gatesFader` in `@gallery/driver-core`.
 */
export function faderRenderHints(
  widgets: WidgetBinding[],
  state: Record<string, unknown> | undefined,
): FaderRenderHints {
  const companion = widgets.find(
    (widget): widget is Extract<WidgetBinding, { kind: 'power' | 'mute' }> =>
      widget.kind === 'power' || widget.kind === 'mute',
  )
  if (!companion) return { dimmed: false, blockCommit: false }

  const raw = readBoolLike(state?.[companion.stateKey])
  const offOrMuted = companion.kind === 'power' ? !raw : raw
  const gatesFader = companion.kind === 'power' && companion.gatesFader !== false
  return { dimmed: offOrMuted, blockCommit: gatesFader && offOrMuted }
}

/** The `{labelsKey, countKey, fallbackLabel}` shape shared by every "build a numbered, labeled list from connection config" spot — a select widget's live options and an admin form's address field (see `lib/schemaForm.ts`). */
export interface ConnectionOptionsSpec {
  labelsKey: string
  countKey: string
  fallbackLabel: string
  includeNone?: boolean
}

/**
 * Build a `{labelsKey,countKey,fallbackLabel}` spec's {value,label}[] from
 * connection config: entries `1..count`, each labeled `"{n}. {labels[n-1]}"`
 * when named or `"{fallbackLabel} {n}"` when not. Returns undefined when the
 * connection has no valid count yet, so the caller can fall through to
 * another source (or a plain input, for `SchemaFields.vue`'s address fields).
 */
export function buildConnectionOptions(
  options: ConnectionOptionsSpec,
  connectionConfig: Record<string, unknown> | undefined,
): { value: number | string; label: string }[] | undefined {
  const count = connectionConfig?.[options.countKey]
  if (typeof count !== 'number' || count <= 0) return undefined

  const labels = connectionConfig?.[options.labelsKey]
  const entries: { value: number | string; label: string }[] = options.includeNone
    ? [{ value: 0, label: 'None' }]
    : []
  for (let index = 1; index <= count; index++) {
    const named = Array.isArray(labels) ? labels[index - 1] : undefined
    const label = typeof named === 'string' && named !== '' ? `${index}. ${named}` : `${options.fallbackLabel} ${index}`
    entries.push({ value: index, label })
  }
  return entries
}

/**
 * Resolve a select widget's option list, trying each source in order:
 * 1. `connectionOptions` — built from the device's own connection config
 *    (e.g. a matrix switcher's input labels), no live state needed.
 * 2. `optionsKey` — a dynamic list the driver stamped onto state.
 * 3. `options` — a static list declared directly in the manifest.
 */
export function selectOptions(
  binding: SelectWidgetBinding,
  state: Record<string, unknown> | undefined,
  connectionConfig?: Record<string, unknown>,
): { value: number | string; label: string }[] {
  const fromConnection = binding.connectionOptions
    ? buildConnectionOptions(binding.connectionOptions, connectionConfig)
    : undefined
  if (fromConnection) return fromConnection

  const dynamic = binding.optionsKey ? state?.[binding.optionsKey] : undefined
  if (Array.isArray(dynamic)) return dynamic as { value: number | string; label: string }[]
  return binding.options ?? []
}

/** One momentary trigger button, resolved from a device's own `address.buttons`. */
export interface ButtonDefinition {
  label: string
  /** Every other field of the button entry, sent verbatim as the command's params. */
  params: Record<string, unknown>
}

/**
 * Read a `buttons` widget's button list from `device.address.buttons` — unlike
 * every other widget kind, this one is per-*device* data (an admin-configured
 * array, validated server-side by that endpoint type's addressSchema), not a
 * manifest-wide constant: "Qlab Jingles" and "Qlab Alarms" are two devices
 * sharing one connection with entirely different buttons. Each entry's `label`
 * is split out for display; everything else becomes that button's command
 * params verbatim (matching whatever shape the driver's `send` command
 * expects — e.g. `{payload}` or `{address, args}`).
 *
 * Malformed entries are skipped rather than thrown on — the address already
 * passed Ajv validation server-side, but a stale cached record shouldn't crash
 * the widget.
 */
export function buttonsFor(device: { address: Record<string, unknown> }): ButtonDefinition[] {
  const raw = device.address?.buttons
  if (!Array.isArray(raw)) return []

  const buttons: ButtonDefinition[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const { label, ...params } = entry as Record<string, unknown>
    if (typeof label !== 'string' || label === '') continue
    buttons.push({ label, params })
  }
  return buttons
}
