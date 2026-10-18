import { useId, useRef, useState, type FormEvent } from 'react'
import { CACHE_MB, setOfflineCacheLimit, type OfflineCleanupPlan } from '@/lib/offline-audio'
import { formatSize } from '@/lib/utils/format'
import { Modal } from '@/components/shared/Modal'

interface Props {
  username: string
  limit: number
  used: number
  onClose: () => void
}

export function OfflineCacheSettings({ username, limit, used, onClose }: Props) {
  const formId = useId()
  const inputId = useId()
  const [value, setValue] = useState(String(limit / CACHE_MB))
  const [cleanup, setCleanup] = useState<OfflineCleanupPlan | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submitting = useRef(false)
  const change = (next: string) => { setValue(next); setCleanup(null); setError('') }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting.current) return
    const mb = Number(value)
    const bytes = mb * CACHE_MB
    if (!Number.isSafeInteger(mb) || mb < 100 || !Number.isSafeInteger(bytes)) {
      setError('请输入不小于 100 的有效整数，单位为 MB')
      return
    }
    submitting.current = true
    setSaving(true)
    setError('')
    try {
      const result = await setOfflineCacheLimit(username, bytes, cleanup?.entries.map(entry => entry.key))
      if (result.saved) onClose()
      else setCleanup(result.cleanup)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试') }
    finally { submitting.current = false; setSaving(false) }
  }

  return <Modal open onClose={() => { if (!submitting.current) onClose() }} title="缓存设置"
    closeButtonLabel="关闭缓存设置" closeDisabled={saving}
    footer={<>
      <button type="button" disabled={saving} onClick={onClose} className="rounded-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">取消</button>
      <button type="submit" form={formId} disabled={saving} className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{saving ? '正在保存…' : cleanup ? '确认清理并保存' : '保存'}</button>
    </>}
  >
    <form id={formId} onSubmit={event => void save(event)} noValidate>
      <p className="mb-5 text-sm text-muted-foreground">已使用 {formatSize(used, 1000)} / {formatSize(limit, 1000)}</p>
      <label htmlFor={inputId} className="mb-2 block text-sm font-medium">缓存总容量上限（MB）</label>
      <input id={inputId} type="number" min={100} step={1} max={Math.floor(Number.MAX_SAFE_INTEGER / CACHE_MB)} required
        value={value} disabled={saving} onChange={event => change(event.target.value)}
        aria-invalid={!!error} aria-describedby={`${inputId}-hint`}
        className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30 disabled:opacity-50" />
      <div className="mt-3 flex flex-wrap gap-2">
        {[100, 500, 1000, 2000, 5000].map(mb => <button key={mb} type="button" disabled={saving}
          aria-pressed={Number(value) === mb} onClick={() => change(String(mb))}
          className={`rounded-full border px-3 py-2 text-xs disabled:opacity-50 ${Number(value) === mb ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'}`}
        >{mb < 1000 ? `${mb} MB` : `${mb / 1000} GB`}</button>)}
      </div>
      <p id={`${inputId}-hint`} className="mt-4 text-xs leading-relaxed text-muted-foreground">最低 100 MB。只限制缓存总大小，空间不足时清理最久未使用的歌曲；超过总容量的单首歌曲不缓存。设置仅保存在此浏览器的当前账号。</p>
      {cleanup && <p role="alert" className="mt-4 rounded-xl border border-border bg-muted/30 p-3 text-sm leading-relaxed">保存此设置将清理 {cleanup.entries.length} 个音频，释放 {formatSize(cleanup.bytes, 1000)}，优先清理最久未使用的歌曲。请确认后保存。</p>}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    </form>
  </Modal>
}
