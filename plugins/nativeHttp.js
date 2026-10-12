import { CapacitorHttp } from '@capacitor/core'
import { isRenewableUrl } from '@/utils/authRenewal'

export default function ({ store, $authRenewal }, inject) {
  const responseError = (res) => new Error(typeof res.data === 'string' ? res.data : `HTTP ${res.status}`)

  const nativeHttp = {
    async request(method, _url, data, options = {}) {
      // When authorizing before a config is set, server config gets passed in as an option
      let serverConnectionConfig = options.serverConnectionConfig || store.state.user.serverConnectionConfig
      delete options.serverConnectionConfig

      let url = _url
      let headers = {}
      if (!url.startsWith('http') && !url.startsWith('capacitor')) {
        const bearerToken = store.getters['user/getToken']
        if (bearerToken) {
          headers['Authorization'] = `Bearer ${bearerToken}`
        } else {
          console.warn('[nativeHttp] No Bearer Token for request')
        }
        if (serverConnectionConfig?.address) {
          url = `${serverConnectionConfig.address}${url}`
        }
      }
      if (data) {
        headers['Content-Type'] = 'application/json'
      }
      if (options.headers) {
        headers = { ...headers, ...options.headers }
        delete options.headers
      }
      console.log(`[nativeHttp] Making ${method} request to ${url}`)

      const res = await CapacitorHttp.request({ method, url, data, headers, ...options })
      if (res.status === 401) {
        console.error(`[nativeHttp] 401 status for url "${url}"`)
        // The token this request was sent with, and the saved server it belongs to
        const sentToken = (headers['Authorization'] || '').replace(/^Bearer /, '')
        if (sentToken && serverConnectionConfig?.id && isRenewableUrl(url)) {
          return this.retryAfterRenewal({ method, url, data, headers, options }, serverConnectionConfig.id, sentToken)
        }
      }
      if (res.status >= 400) {
        console.error(`[nativeHttp] ${res.status} status for url "${url}"`)
        throw responseError(res)
      }
      return res.data
    },

    /**
     * Waits for the shared renewal of this server's access token (one per server, however many requests got a 401)
     * and retries the request once. A refused refresh token signs out through $authRenewal; any other failure only
     * fails this request.
     */
    async retryAfterRenewal({ method, url, data, headers, options }, serverConnectionConfigId, sentToken) {
      const accessToken = await $authRenewal.renew({ serverConnectionConfigId, token: sentToken })

      console.log('[nativeHttp] Retrying original request with new token...')
      const retryResponse = await CapacitorHttp.request({
        method,
        url,
        data,
        headers: {
          ...headers,
          Authorization: `Bearer ${accessToken}`
        },
        ...options
      })
      if (retryResponse.status >= 400) {
        console.error(`[nativeHttp] Retry request failed with status ${retryResponse.status}`)
        throw responseError(retryResponse)
      }
      return retryResponse.data
    },

    get(url, options = {}) {
      return this.request('GET', url, undefined, options)
    },
    post(url, data, options = {}) {
      return this.request('POST', url, data, options)
    },
    patch(url, data, options = {}) {
      return this.request('PATCH', url, data, options)
    },
    delete(url, options = {}) {
      return this.request('DELETE', url, undefined, options)
    }
  }
  inject('nativeHttp', nativeHttp)
}
