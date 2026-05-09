import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('../views/Dashboard.vue') },
    { path: '/connections', component: () => import('../views/Connections.vue') },
    { path: '/devices', component: () => import('../views/Devices.vue') },
    { path: '/scenes', component: () => import('../views/Scenes.vue') },
    { path: '/scenes/:id', component: () => import('../views/SceneEditor.vue') },
    { path: '/schedules', component: () => import('../views/Schedules.vue') },
    { path: '/mappings', component: () => import('../views/Mappings.vue') },
    { path: '/layouts', component: () => import('../views/Layouts.vue') },
    { path: '/logs', component: () => import('../views/Logs.vue') },
    { path: '/settings', component: () => import('../views/Settings.vue') },
  ],
});

export default router;
