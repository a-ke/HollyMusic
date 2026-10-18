import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'

function worker() {
  const handlers: Record<string, (event: unknown) => void> = {}
  const cache = { addAll: vi.fn(async () => {}), match: vi.fn(async () => new Response('offline shell')) }
  const caches = { open: vi.fn(async () => cache), keys: vi.fn(async () => [
    'holly-shell-shell-dev', 'holly-shell-old', 'holly-static-v3', 'holly-pages-v3', 'holly-audio-v1:alice', 'other-app',
  ]), delete: vi.fn(async () => true) }
  const fetch = vi.fn(async () => { throw new TypeError('offline') })
  const self = { addEventListener: (name: string, handler: (event: unknown) => void) => { handlers[name] = handler },
    clients: { claim: vi.fn() }, location: { origin: 'https://holly.test' } }
  class WorkerRequest extends Request {
    constructor(input: string, init?: RequestInit) { super(new URL(input, self.location.origin), init) }
  }
  runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    self, caches, fetch, URL, Set, Request: WorkerRequest, Response, AbortSignal,
  })
  return { handlers, cache, caches, fetch, self }
}

it('必需资源预缓存失败会阻止安装，不激活残缺应用壳', async () => {
  const { handlers, cache } = worker()
  cache.addAll.mockRejectedValueOnce(new Error('missing chunk'))
  let install!: Promise<void>
  handlers.install({ waitUntil: (value: Promise<void>) => { install = value } })
  await expect(install).rejects.toThrow('missing chunk')
})

it('激活新版本只清理应用壳旧缓存，保留歌曲及其他应用缓存', async () => {
  const { handlers, caches } = worker()
  let activation!: Promise<void>
  handlers.activate({ waitUntil: (value: Promise<void>) => { activation = value } })
  await activation
  expect(caches.delete.mock.calls.map(([key]) => key)).toEqual(['holly-shell-old', 'holly-static-v3', 'holly-pages-v3'])
})

it('断网深层路由及带查询参数的安装启动地址均回退首页壳', async () => {
  const { handlers, cache } = worker()
  for (const route of ['/playlists/2', '/?source=pwa']) {
    let result!: Promise<Response>
    handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: `https://holly.test${route}` },
      respondWith: (value: Promise<Response>) => { result = value } })
    expect(await (await result).text()).toBe('offline shell')
  }
  expect(cache.match).toHaveBeenCalledWith('/')
})

it('API、Subsonic、跨域和写入请求不会写入应用壳缓存', () => {
  const { handlers } = worker()
  const respondWith = vi.fn()
  for (const [url, method] of [
    ['https://holly.test/api/audio?uid=kw-1', 'GET'], ['https://holly.test/rest/stream', 'GET'],
    ['https://upstream.test/file.mp3', 'GET'], ['https://holly.test/', 'POST'],
  ]) handlers.fetch({ request: { method, url }, respondWith })
  expect(respondWith).not.toHaveBeenCalled()
})
