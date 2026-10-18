import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { OfflineCacheSettings } from '../src/components/OfflineCacheSettings'
import { OfflinePage } from '../src/routes/OfflinePage'
import { useAuthStore } from '@/hooks/useAuth'
import { CACHE_MB, setOfflineCacheLimit, listOfflineTracks } from '@/lib/offline-audio'
import type { OfflineTrack } from '@/lib/offline-audio'
import { toTrack } from '@/lib/types/player'

vi.mock('@/lib/offline-audio', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/offline-audio')>(),
  listOfflineTracks: vi.fn(async () => []), setOfflineCacheLimit: vi.fn(),
}))
vi.mock('@/components/shared/SongList', () => ({ SongList: () => null }))

let container: HTMLDivElement
let root: Root
let onClose: ReturnType<typeof vi.fn>
const entry: OfflineTrack = {
  key: 'key', size: 4, quality: '320k', usedAt: 1,
  track: toTrack({ uid: 'kw-1', musicInfo: { name: '歌曲', singer: '歌手', source: 'kw', songmid: '1', interval: '03:00', types: [], _types: {}, typeUrl: {},
  } as Parameters<typeof toTrack>[0]['musicInfo'] }),
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false } })
  localStorage.clear()
  useAuthStore.setState({ authenticated: true, username: 'alice', offlineUsername: null })
  vi.mocked(setOfflineCacheLimit).mockReset()
  vi.mocked(listOfflineTracks).mockResolvedValue([])
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  onClose = vi.fn()
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
async function renderSettings() {
  await act(async () => root.render(<OfflineCacheSettings username="alice" limit={500 * CACHE_MB} used={180 * CACHE_MB} onClose={onClose} />))
}
async function change(value: string) {
  await act(async () => {
    const input = container.querySelector('input')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function submit() {
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
}

it('从弹窗内选中文字拖到外面释放时不关闭，直接点击背景才关闭', async () => {
  await renderSettings()
  const mask = container.querySelector<HTMLElement>('[data-modal-mask]')!
  const text = mask.querySelector('p')!
  await act(async () => {
    text.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 150, clientY: 150 }))
    mask.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 50, clientY: 50 }))
    mask.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 50 }))
  })
  expect(onClose).not.toHaveBeenCalled()
  await act(async () => {
    mask.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 50, clientY: 50 }))
    mask.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 50, clientY: 50 }))
    mask.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 50 }))
  })
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('从背景拖入弹窗内部或取消指针操作时不关闭', async () => {
  await renderSettings()
  const mask = container.querySelector<HTMLElement>('[data-modal-mask]')!
  await act(async () => {
    mask.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 50, clientY: 50 }))
    mask.querySelector('.modal-panel')!.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 150, clientY: 150 }))
    mask.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 150, clientY: 150 }))
    mask.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 50, clientY: 50 }))
    mask.dispatchEvent(new Event('pointercancel', { bubbles: true }))
    mask.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 50 }))
  })
  expect(onClose).not.toHaveBeenCalled()
})

it('缓存设置使用独立遮罩，普通遮罩点击关闭', async () => {
  await renderSettings()
  const mask = container.querySelector<HTMLElement>('[data-modal-mask]')!
  await act(async () => {
    mask.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 50, clientY: 50 }))
    mask.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 50, clientY: 50 }))
    mask.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 50 }))
  })
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('设置按钮在清空左侧，弹窗读取当前容量', async () => {
  vi.mocked(listOfflineTracks).mockResolvedValue([entry])
  await act(async () => root.render(<OfflinePage />))
  const buttons = [...container.querySelectorAll('button')]
  const settings = buttons.find(button => button.getAttribute('aria-label') === '缓存设置')!
  const clear = buttons.find(button => button.textContent?.includes('清空'))!
  expect(buttons.indexOf(settings)).toBeLessThan(buttons.indexOf(clear))
  await act(async () => settings.click())
  expect(container.querySelector('dialog')?.open).toBe(true)
  expect(container.querySelector('input')?.value).toBe('500')
})

it.each(['99', '', '-1', '100.5'])('拒绝不合法的容量 %s，不保存也不关闭', async value => {
  await renderSettings()
  await change(value)
  await submit()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('不小于 100')
  expect(setOfflineCacheLimit).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})

it('最低值 100 MB 可保存，MB 使用十进制且保存成功后关闭', async () => {
  vi.mocked(setOfflineCacheLimit).mockResolvedValue({ saved: true, cleanup: { entries: [], bytes: 0 } })
  await renderSettings()
  await change('100')
  await submit()
  expect(setOfflineCacheLimit).toHaveBeenCalledWith('alice', 100_000_000, undefined)
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('先展示清理歌曲数量与空间，二次确认才提交清理', async () => {
  const cleanup = { entries: [{ ...entry, key: 'old-1' }, { ...entry, key: 'old-2' }], bytes: 50 * CACHE_MB }
  vi.mocked(setOfflineCacheLimit).mockResolvedValueOnce({ saved: false, cleanup })
  await renderSettings()
  await change('100')
  await submit()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('2 个音频')
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('50.0 MB')
  expect(onClose).not.toHaveBeenCalled()
  vi.mocked(setOfflineCacheLimit).mockResolvedValueOnce({ saved: true, cleanup })
  await submit()
  expect(setOfflineCacheLimit).toHaveBeenLastCalledWith('alice', 100 * CACHE_MB, ['old-1', 'old-2'])
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('修改容量撤销旧清理确认，预设与自定义输入使用相同保存流程', async () => {
  vi.mocked(setOfflineCacheLimit).mockResolvedValueOnce({ saved: false, cleanup: { entries: [entry], bytes: entry.size } })
  await renderSettings()
  await change('100')
  await submit()
  expect(container.querySelector('[role="alert"]')).not.toBeNull()
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '1 GB')!.click())
  expect(container.querySelector('[role="alert"]')).toBeNull()
  expect(container.querySelector('input')?.value).toBe('1000')
  vi.mocked(setOfflineCacheLimit).mockResolvedValueOnce({ saved: true, cleanup: { entries: [], bytes: 0 } })
  await submit()
  expect(setOfflineCacheLimit).toHaveBeenLastCalledWith('alice', 1_000_000_000, undefined)
})

it('列表为空时仍可打开设置，关闭后不会改变容量', async () => {
  await act(async () => root.render(<OfflinePage />))
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="缓存设置"]')!.click())
  expect(container.querySelector('dialog')?.open).toBe(true)
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="关闭缓存设置"]')!.click())
  expect(container.querySelector('dialog')).toBeNull()
  expect(setOfflineCacheLimit).not.toHaveBeenCalled()
})

it('取消不保存，存储失败保留弹窗和错误信息', async () => {
  await renderSettings()
  vi.mocked(setOfflineCacheLimit).mockRejectedValueOnce(new Error('无法保存设置'))
  await submit()
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('无法保存设置')
  expect(onClose).not.toHaveBeenCalled()
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '取消')!.click())
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(setOfflineCacheLimit).toHaveBeenCalledTimes(1)
})
