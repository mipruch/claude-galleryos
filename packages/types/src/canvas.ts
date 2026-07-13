/**
 * Workflow canvas contracts — shared by server and UI.
 *
 * The admin "Workflows" canvas (trigger routing map + per-scene action graph,
 * README-adjacent to the Scenes/Mappings/Schedules admin pages) is a spatial
 * view over rows that already exist (`scene_actions`, `input_mappings`,
 * `scheduled_jobs`); it adds nothing to the execution model. `position` is the
 * only new persisted concept: where a node was last dropped, so the layout
 * survives a reload instead of being re-computed (auto-layout) every time.
 *
 * Kept in its own module (not `records.ts`) so `schema.ts` can type the
 * `position` columns against `CanvasPosition` without importing `records.ts`
 * (which would be a cycle: records derives its row types from the schema) —
 * same reasoning as `kiosk.ts`.
 */

/** Where a node was last dropped on a workflow canvas, in canvas pixel units. */
export interface CanvasPosition {
  x: number;
  y: number;
}
