import { isRenewableUrl } from '@/utils/authRenewal'

export default function ({ $axios, store, $authRenewal }) {
  $axios.onRequest((config) => {
    console.log('[Axios] Making request to ' + config.url)
    if (config.url.startsWith('http:') || config.url.startsWith('https:') || config.url.startsWith('capacitor:')) {
      return
    }

    const bearerToken = store.getters['user/getToken']
    if (bearerToken) {
      config.headers.common['Authorization'] = `Bearer ${bearerToken}`
      // The saved server and token this request was sent with, for renewal after a 401
      config._auth = { serverConnectionConfigId: store.getters['user/getServerConnectionConfigId'], token: bearerToken }
    } else {
      console.warn('[Axios] No Bearer Token for request')
    }

    const serverUrl = store.getters['user/getServerAddress']
    if (serverUrl) {
      config.url = `${serverUrl}${config.url}`
    }
    console.log('[Axios] Request out', config.url)
  })

  $axios.onError(async (error) => {
    const originalRequest = error.config
    const code = parseInt(error.response && error.response.status)
    const message = error.response ? error.response.data || 'Unknown Error' : 'Unknown Error'

    console.error('Axios error', code, message)

    // Handle 401 Unauthorized (token expired): one shared renewal per server, then one retry of this request.
    // A refused refresh token signs out through $authRenewal.
    if (code === 401 && originalRequest?._auth && !originalRequest._retry && isRenewableUrl(originalRequest.url)) {
      originalRequest._retry = true
      const newAccessToken = await $authRenewal.renew(originalRequest._auth)

      // Update the original request with new token
      if (!originalRequest.headers) {
        originalRequest.headers = {}
      }
      originalRequest.headers['Authorization'] = `Bearer ${newAccessToken}`

      // Retry the original request
      return $axios(originalRequest)
    }

    return Promise.reject(error)
  })
}
