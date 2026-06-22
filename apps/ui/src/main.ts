import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { router } from './router'
import { useThemeStore } from './stores/theme'

const app = createApp(App)

app.use(createPinia())
app.use(router)

// Apply the saved theme before mount so there's no flash of the wrong mode.
useThemeStore().init()

app.mount('#app')
