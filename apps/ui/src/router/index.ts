/**
 * App routes, split by layout:
 *   - User panel (`UserLayout`) at the root — device control, schedules monitor.
 *     The room pages render `DevicesView`; the route's `roomId` param drives the
 *     device scope so the URL is the source of truth and a refresh stays put.
 *   - Admin portal (`AdminLayout`) under `/admin/**` — only the built pages are
 *     registered; later passes add connections/devices/scenes/etc. Access is
 *     structural for now (no auth — PLAN P6); the `meta.admin` flag and the
 *     guard placeholder below are where a real auth check will slot in.
 */
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import UserLayout from '@/layouts/UserLayout.vue'
import AdminLayout from '@/layouts/AdminLayout.vue'
import DevicesView from '@/views/DevicesView.vue'
import IframeView from '@/views/IframeView.vue'
import SchedulesView from '@/views/SchedulesView.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: UserLayout,
    children: [
      { path: '', name: 'home', component: DevicesView },
      { path: 'rooms/:roomId', name: 'room', component: DevicesView },
      {
        path: 'schedules',
        name: 'schedules',
        component: SchedulesView,
        meta: { title: 'Schedules', subtitle: 'Upcoming scheduled scenes' },
      },
      { path: 'iframes/:iframeId', name: 'iframe', component: IframeView },
    ],
  },
  {
    path: '/admin',
    component: AdminLayout,
    meta: { admin: true },
    children: [
      { path: '', redirect: { name: 'admin-dashboard' } },
      {
        path: 'rooms',
        name: 'admin-rooms',
        component: () => import('@/views/admin/RoomsView.vue'),
        meta: { title: 'Rooms', subtitle: 'Group devices and scenes' },
      },
      {
        path: 'dashboard',
        name: 'admin-dashboard',
        component: () => import('@/views/admin/DashboardView.vue'),
        meta: { title: 'Dashboard', subtitle: 'System overview' },
      },
      {
        path: 'connections',
        name: 'admin-connections',
        component: () => import('@/views/admin/ConnectionsView.vue'),
        meta: { title: 'Connections', subtitle: 'Gateways and device links' },
      },
      {
        path: 'devices',
        name: 'admin-devices',
        component: () => import('@/views/admin/DevicesView.vue'),
        meta: { title: 'Devices', subtitle: 'Addressable endpoints' },
      },
      {
        path: 'scenes',
        name: 'admin-scenes',
        component: () => import('@/views/admin/ScenesView.vue'),
        meta: { title: 'Scenes', subtitle: 'Orchestrated device actions' },
      },
      {
        path: 'schedules',
        name: 'admin-schedules',
        component: () => import('@/views/admin/SchedulesView.vue'),
        meta: { title: 'Schedules', subtitle: 'CRON jobs that run scenes' },
      },
      {
        path: 'iframes',
        name: 'admin-iframes',
        component: () => import('@/views/admin/IframesView.vue'),
        meta: { title: 'Iframes', subtitle: 'Embedded device UIs' },
      },
      {
        path: 'mappings',
        name: 'admin-mappings',
        component: () => import('@/views/admin/MappingsView.vue'),
        meta: { title: 'Mappings', subtitle: 'OSC/TCP/HTTP signals → actions' },
      },
      {
        path: 'logs',
        name: 'admin-logs',
        component: () => import('@/views/admin/LogsView.vue'),
        meta: { title: 'Logs', subtitle: 'Structured server logs' },
      },
      {
        path: 'settings',
        name: 'admin-settings',
        component: () => import('@/views/admin/SettingsView.vue'),
        meta: { title: 'Settings', subtitle: 'Appearance, system and drivers' },
      },
    ],
  },
  // Unknown paths fall back to the user home page.
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

// Auth guard placeholder — when P6 (authentication) lands, gate `meta.admin`
// routes here:
//   router.beforeEach((to) => to.meta.admin && !isAuthed() ? '/login' : true)
