/**
 * Shared open-state for the scene editor — the one merged interface for
 * creating/editing a scene, replacing the old split between an `/admin/scenes`
 * modal and the `/admin/workflows/scenes/:id` page. Any control (the admin
 * scenes list's New/Edit buttons, a workflow target's "Edit scene steps"
 * button) opens it without prop-drilling or a route change; `SceneEditorDialog`
 * is mounted once in `AdminLayout` and reacts to this state, the same pattern
 * `useCommandPalette` uses for the command palette.
 */
import { ref } from 'vue'

const open = ref(false)
/** The scene being edited, or `null` for "new scene". */
const sceneId = ref<string | null>(null)

export function useSceneEditor() {
  return {
    open,
    sceneId,
    /** Open the editor — pass an id to edit that scene, omit for a new one. */
    openEditor: (id?: string): void => {
      sceneId.value = id ?? null
      open.value = true
    },
    close: (): void => {
      open.value = false
    },
  }
}
