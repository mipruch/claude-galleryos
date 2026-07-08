/**
 * App routes, split by layout:
 *   - User panel (`UserLayout`) at the root — device control, schedules monitor.
 *     The room pages render `DevicesView`; the route's `roomId` param drives the
 *     device scope so the URL is the source of truth and a refresh stays put.
 *   - Admin portal (`AdminLayout`) under `/admin/**` — only reachable to a role
 *     with `isAdmin` (see the guard below and `stores/auth.ts`).
 *
 * Auth is a front-end-only gate (PLAN.md "Priority 6", simplified): the guard
 * below checks the locally-remembered `useAuthStore` state, not a server
 * session — every route except `/login` and the kiosk viewer requires a
 * logged-in user, and `meta.admin` routes additionally require an admin role.
 */
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import UserLayout from '@/layouts/UserLayout.vue'
import AdminLayout from '@/layouts/AdminLayout.vue'
import DevicesView from '@/views/DevicesView.vue'
import IframeView from '@/views/IframeView.vue'
import SchedulesView from '@/views/SchedulesView.vue'
import { resolveGuard } from '@/lib/router'
import { useAuthStore } from '@/stores/auth'

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
      // Lazy-loaded so hls.js only enters the bundle when a camera is opened.
      {
        path: 'cameras/:cameraId',
        name: 'camera',
        component: () => import('@/views/CameraView.vue'),
      },
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
        path: 'layouts',
        name: 'admin-layouts',
        component: () => import('@/views/admin/LayoutsView.vue'),
        meta: { title: 'Layouts', subtitle: 'Wall-screen & tablet kiosks' },
      },
      {
        path: 'layouts/:id',
        name: 'admin-layout-builder',
        component: () => import('@/views/admin/KioskBuilderView.vue'),
        meta: { title: 'Layout builder', subtitle: 'Arrange device widgets'},
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
      {
        path: 'users',
        name: 'admin-users',
        component: () => import('@/views/admin/UsersView.vue'),
        meta: { title: 'Users', subtitle: 'Accounts and roles' },
      },
    ],
  },
  // Simple username + password lock screen — outside both layouts, like the
  // kiosk viewer below, since it must render with no session at all.
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
  },
  // Chromeless kiosk viewer — no header/sidebar, just the canvas (toasts come
  // from the global shell in App.vue). Looked up by name (the URL key — hence
  // `:name`, not `:id`; the two were confused here before). Its own PIN pad
  // gates it, independently of the username/password login above.
  {
    path: '/kiosk/:name',
    name: 'kiosk',
    component: () => import('@/views/KioskView.vue'),
  },
  // Unknown paths fall back to the user home page.
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

// Front-end login gate (see the file header). `useAuthStore().init()` restores
// a previous login from sessionStorage before the app mounts (see main.ts), so
// by the time this guard runs, `isAuthenticated`/`isAdmin` already reflect it.
// Decision logic lives in `lib/router.ts` (pure, unit-tested).
router.beforeEach((to) => {
  const auth = useAuthStore()
  return resolveGuard(to, { isAuthenticated: auth.isAuthenticated, isAdmin: auth.isAdmin })
})
