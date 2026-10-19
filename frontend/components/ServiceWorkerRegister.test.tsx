import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ServiceWorkerRegister } from '../src/components/ServiceWorkerRegister'
import { logger } from '@/lib/logger'

vi.mock('@/hooks/usePwaInstall', () => ({ registerPwaInstall: () => {} }))
vi.mock('@/lib/browser-storage', () => ({ isCacheStorageAvailable: () => true }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('只通过 logger 输出当前 SW 的有效诊断，卸载时移除监听', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const warning = vi.spyOn(logger, 'warn').mockImplementation(() => {})
  const controller = { postMessage: vi.fn() } as unknown as ServiceWorker
  const worker = Object.assign(new EventTarget(), {
    controller, register: vi.fn(async () => ({ active: controller })),
  })
  vi.stubGlobal('navigator', { serviceWorker: worker })
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete')
  const container = document.createElement('div')
  const root = createRoot(container)
  const data = { type: 'holly-sw-diagnostic', operation: 'write-chunk', name: 'QuotaExceededError', message: 'disk full' }
  const message = (value: unknown, source: ServiceWorker = controller) => new MessageEvent('message', { data: value, source })
  try {
    await act(async () => { root.render(<ServiceWorkerRegister />) })
    worker.dispatchEvent(message(data, {} as ServiceWorker))
    worker.dispatchEvent(message({ ...data, message: null }))
    expect(warning).not.toHaveBeenCalled()
    worker.dispatchEvent(message(data))
    expect(warning).toHaveBeenCalledExactlyOnceWith('[SW] write-chunk', { name: 'QuotaExceededError', message: 'disk full' })
  } finally { await act(async () => { root.unmount() }) }
  warning.mockClear()
  worker.dispatchEvent(message(data))
  expect(warning).not.toHaveBeenCalled()
})
