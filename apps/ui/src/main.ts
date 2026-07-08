import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { router } from './router'
import { useThemeStore } from './stores/theme'
import { useAuthStore } from './stores/auth'

const app = createApp(App)

app.use(createPinia())
app.use(router)

// Apply the saved theme before mount so there's no flash of the wrong mode.
useThemeStore().init()
// Restore a previous login from sessionStorage before the router's first
// navigation guard runs (see router/index.ts).
useAuthStore().init()

app.mount('#app')
