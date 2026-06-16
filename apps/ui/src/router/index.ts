/**
 * App routes. Both pages render the same `DevicesView`; the route's `roomId`
 * param (absent on the home page) drives the device scope in the store, so the
 * URL is the source of truth and a refresh stays on the same page.
 */
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import DevicesView from '@/views/DevicesView.vue'
import IframeView from '@/views/IframeView.vue'

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: DevicesView },
  { path: '/rooms/:roomId', name: 'room', component: DevicesView },
  { path: '/iframes/:iframeId', name: 'iframe', component: IframeView },
  // Unknown paths fall back to the home page.
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})
