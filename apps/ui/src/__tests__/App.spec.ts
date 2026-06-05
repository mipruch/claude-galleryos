import { describe, it, expect, beforeAll, vi } from 'vitest'

import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import App from '../App.vue'
import DevicesView from '../views/DevicesView.vue'

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

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: DevicesView },
      { path: '/rooms/:roomId', component: DevicesView },
    ],
  })
}

describe('App', () => {
  it('renders the device control shell', async () => {
    const router = makeRouter()
    await router.push('/')
    await router.isReady()
    const wrapper = mount(App, { global: { plugins: [createPinia(), router] } })
    expect(wrapper.text()).toContain('GalleryOS')
    expect(wrapper.text()).toContain('All devices')
  })
})
