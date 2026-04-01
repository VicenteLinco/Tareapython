import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'
import { useAuthStore } from '@/hooks/use-auth-store'

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config: any) => {
  const token = useAuthStore.getState().accessToken
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }

  // Idempotency centralizada para mutaciones (resiste reintentos de axios)
  const method = config.method?.toLowerCase() || ''
  if (['post', 'put', 'patch'].includes(method)) {
    if (!config._idempotencyKey && !config.headers['X-Idempotency-Key'] && !config.headers['x-idempotency-key']) {
      config._idempotencyKey = uuidv4()
    }
    const key = config._idempotencyKey || config.headers['X-Idempotency-Key'] || config.headers['x-idempotency-key']
    config.headers['X-Idempotency-Key'] = key
  }

  return config
})

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true
      const refreshToken = useAuthStore.getState().refreshToken
      if (refreshToken) {
        try {
          const res = await axios.post('/api/v1/auth/refresh', {
            refresh_token: refreshToken,
          })
          const { access_token, refresh_token } = res.data
          useAuthStore.getState().setTokens(access_token, refresh_token)
          original.headers.Authorization = `Bearer ${access_token}`
          return api(original)
        } catch {
          useAuthStore.getState().logout()
          window.location.href = '/login'
        }
      } else {
        useAuthStore.getState().logout()
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export default api
