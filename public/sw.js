/** 构建时注入内容版本和完整资源清单。API、歌曲由前端独立管理。 */
const VERSION = 'shell-dev'
const PRECACHE = ['/', '/manifest.json', '/icon.svg', '/theme-init.js', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png']
const SHELL_CACHE = `holly-shell-${VERSION}`
const ASSETS = new Set(PRECACHE)

self.addEventListener('install', event => {
  // 任一必需资源失败则保留旧 SW；更新等待所有旧页面关闭后生效，避免混用两个版本。
  event.waitUntil(caches.open(SHELL_CACHE).then(cache =>
    cache.addAll(PRECACHE.map(url => new Request(url, { cache: 'reload' })))))
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(key =>
      (key.startsWith('holly-shell-') && key !== SHELL_CACHE)
      || /^holly-(static|pages)-v\d+$/.test(key)
    ).map(key => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin
    || url.pathname.startsWith('/api/') || url.pathname.startsWith('/rest/')) return
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { signal: AbortSignal.timeout(4000) })
        if (response.ok || response.status < 500) return response
      } catch { /* 断网或超时，使用与缓存脚本一致的 HTML。 */ }
      const cache = await caches.open(SHELL_CACHE)
      return await cache.match('/') || Response.error()
    })())
    return
  }
  // 仅缓存构建清单里的公开资源，不把动态响应写进应用壳缓存。
  if (ASSETS.has(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE)
      return await cache.match(url.pathname) || fetch(request)
    })())
  }
})
