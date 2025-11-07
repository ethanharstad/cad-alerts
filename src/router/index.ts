import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import { useSettingsStore } from '@/stores/settings'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    {
      path: '/about',
      name: 'about',
      // route level code-splitting
      // this generates a separate chunk (About.[hash].js) for this route
      // which is lazy-loaded when the route is visited.
      component: () => import('../views/AboutView.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/SettingsView.vue'),
    },
  ],
})

// Navigation guard to ensure settings are configured
router.beforeEach((to, from, next) => {
  const settingsStore = useSettingsStore()

  // Check if both required settings are present
  const hasRequiredSettings =
    settingsStore.organizationKey &&
    settingsStore.organizationSecret

  // If navigating to settings page, always allow
  if (to.name === 'settings') {
    next()
    return
  }

  // If settings are missing, redirect to settings page
  if (!hasRequiredSettings) {
    next({ name: 'settings' })
    return
  }

  // Otherwise, proceed with navigation
  next()
})

export default router
