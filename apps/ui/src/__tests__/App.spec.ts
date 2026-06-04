import { describe, it, expect, beforeAll, vi } from 'vitest'

import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import App from '../App.vue'

beforeAll(() => {
  // jsdom provides neither fetch nor WebSocket; stub just enough for App to
  // mount and run its onMounted hook without throwing.
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [],
  }) as unknown as typeof fetch
  globalThis.WebSocket = class {
    close() {}
    send() {}
    addEventListener() {}
    removeEventListener() {}
  } as unknown as typeof WebSocket
})

describe('App', () => {
  it('renders the device control panel', () => {
    const wrapper = mount(App, { global: { plugins: [createPinia()] } })
    expect(wrapper.text()).toContain('GalleryOS')
  })
})
