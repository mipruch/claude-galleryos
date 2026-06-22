import type { InjectionKey } from "vue"

/** Shared item id so label/control/description/message stay associated (a11y). */
export const FORM_ITEM_INJECTION_KEY: InjectionKey<string> = Symbol("FormItemId")
