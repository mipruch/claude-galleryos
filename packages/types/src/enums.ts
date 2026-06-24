/**
 * Closed enumerations for values that travel across the API / WS / DB and so must
 * agree on every end. Type-only — the DB columns stay `varchar`, these just narrow
 * the TypeScript view (via Drizzle `$type<>()`) so a typo is a compile error.
 */

/** A scene action's failure policy. */
export type OnFailure = "continue" | "abort";

/** Lifecycle status of a scene execution row. */
export type ExecutionStatus = "running" | "completed" | "failed" | "aborted" | "interrupted";

/** Transport an input mapping listens on (`input_mappings.protocol`). */
export type InputProtocol = "osc" | "tcp" | "http";

/** What a matched input mapping does (`input_mappings.target_type`). */
export type InputTargetType = "scene.execute" | "device.command" | "event.emit";
