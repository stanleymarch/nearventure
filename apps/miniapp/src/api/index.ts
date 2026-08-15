import axios from 'axios';

/**
 * Mini App HTTP surface. It owns its Telegram JWT while contracts and feature
 * clients live in workspace packages; it must not borrow the web app's Axios
 * singleton or its `auth_token` interceptor.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/';

export const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('nv_tg_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export async function getPoiCount(): Promise<{ total: number }> {
  return (await api.get<{ total: number }>('/api/pois/count')).data;
}
