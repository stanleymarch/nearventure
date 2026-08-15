import { createRouter, createWebHashHistory } from 'vue-router';

const requireAuth = (to: any, from: any, next: any) => {
  const token = localStorage.getItem('auth_token');
  if (!token) {
    next({ name: 'login' });
  } else {
    next();
  }
};

const router = createRouter({
  history: createWebHashHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    {
      path: '/',
      name: 'landing',
      component: () => import('@/views/LandingView.vue'),
    },
    {
      path: '/map',
      name: 'home',
      component: () => import('@/views/AdventureView.vue'),
      meta: { immersive: true },
    },
    // Keep the previously published adventure URL working.
    {
      path: '/adventure',
      redirect: { name: 'home' },
    },
    {
      path: '/route/:id',
      name: 'route-detail',
      component: () => import('@/views/RouteDetailView.vue'),
      meta: { immersive: true },
    },
    {
      path: '/catalog',
      name: 'catalog',
      component: () => import('@/views/WebCatalogView.vue'),
    },
    {
      path: '/about',
      name: 'about',
      component: () => import('@/views/AboutView.vue'),
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { guest: true },
    },
    {
      path: '/admin',
      component: () => import('@/layouts/AdminLayout.vue'),
      beforeEnter: requireAuth,
      redirect: { name: 'admin-users' },
      children: [
        {
          path: '',
          name: 'admin-users',
          component: () => import('@/views/admin/ManageUsersView.vue'),
        },
      ],
    },
  ],
});

export default router;
