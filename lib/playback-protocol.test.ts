import { expect, it } from 'vitest'
import { createPlaybackManifest, parsePlaybackManifest, playbackDataKey, isPlaybackDataLocation,
  isPlaybackWorkerCommand, isPlaybackWorkerReply, PLAYBACK_CHUNK_BYTES } from './playback-protocol'

const origin = 'https://holly.test'
const id = 'capture/1'
const key = playbackDataKey('tab', id, 'complete', origin)
const manifest = () => createPlaybackManifest(4, { 'content-length': '4', 'content-type': 'audio/mpeg' },
  [{ key: playbackDataKey('tab', id, 0, origin), length: 4 }])

it('分块清单生产与解析共用结构，编码后的捕获标识仍保持一致', () => {
  expect(isPlaybackDataLocation(key, id, origin)).toBe(true)
  expect(parsePlaybackManifest(manifest(), key, id, 100)).toEqual(manifest())
})

it.each([
  () => ({ ...manifest(), version: 2 }),
  () => ({ ...manifest(), size: 5 }),
  () => ({ ...manifest(), headers: null }),
  () => ({ ...manifest(), chunks: [null] }),
  () => ({ ...manifest(), chunks: [{ key: 'https://other.test/0', length: 4 }] }),
  () => ({ ...manifest(), chunks: [{ key: playbackDataKey('tab', id, 0, origin), length: PLAYBACK_CHUNK_BYTES + 1 }] }),
])('拒绝未知版本、损坏结构及不匹配的分块', invalid => {
  expect(() => parsePlaybackManifest(invalid(), key, id, 100)).toThrow()
})

it.each(['https://other.test/__playback_data/tab/capture%2F1/complete', 'invalid-url',
  'https://holly.test/__playback_data/tab/other/complete', `${key}?extra=1`])('拒绝不属于当前捕获的清单位置 %s', value => {
  expect(isPlaybackDataLocation(value, id, origin)).toBe(false)
})

it.each([null, {}, { type: 'holly-capture-audio', url: '/api/audio', limit: '100' },
  { type: 'holly-release-audio', url: '/api/audio', captureId: 'id', preservePlayback: 'true' },
  { type: 'holly-capture-audio', url: '/api/audio', limit: 100, protocolVersion: '1' }])('拒绝无效命令字段 %j', value => {
  expect(isPlaybackWorkerCommand(value)).toBe(false)
})

it('允许旧版无版本号握手与 Blob 回复，未知数字版本交由协商判断', () => {
  expect(isPlaybackWorkerReply({ type: 'ready' })).toBe(true)
  expect(isPlaybackWorkerReply({ type: 'ready', protocolVersion: 2 })).toBe(true)
  expect(isPlaybackWorkerReply({ type: 'complete', blob: new Blob(['data']) })).toBe(true)
  expect(isPlaybackWorkerReply({ type: 'complete', cacheName: 123, cacheKey: key })).toBe(false)
})
