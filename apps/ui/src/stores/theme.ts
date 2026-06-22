/**
 * Theme store — the one client-side preference the admin Settings page owns.
 *
 * Persists a `light | dark | system` choice in `localStorage` and reflects it by
 * toggling the `dark` class on `<html>` (the stylesheet's `@custom-variant dark`
 * keys off `.dark`). `system` follows the OS preference live via `matchMedia`.
 * `init()` is called once at startup so the choice applies app-wide, not just
 * while the Settings page is mounted.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ThemePref = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'galleryos-theme'

export const useThemeStore = defineStore('theme', () => {
  const theme = ref<ThemePref>('system')

  const systemPrefersDark = (): boolean =>
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false

  /** Resolve the preference to an effective mode and toggle the `dark` class. */
  function apply(): void {
    const dark = theme.value === 'dark' || (theme.value === 'system' && systemPrefersDark())
    document.documentElement.classList.toggle('dark', dark)
  }

  function setTheme(next: ThemePref): void {
    theme.value = next
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // ignore storage failures (private mode, quota) — the in-memory choice still applies
    }
    apply()
  }

  /** Hydrate from storage and start following OS changes (call once at startup). */
  function init(): void {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark' || saved === 'system') theme.value = saved
    apply()
    window
      .matchMedia?.('(prefers-color-scheme: dark)')
      .addEventListener?.('change', () => {
        if (theme.value === 'system') apply()
      })
  }

  return { theme, setTheme, init }
})
