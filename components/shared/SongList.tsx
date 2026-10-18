
import { SongRow } from './SongRow'
import type { Track } from '@/lib/types/player'
import type { QualityType } from '@/lib/types/music'

interface SongListProps {
  tracks: Track[]
  localPlayback?: { qualities: QualityType[]; onRemove: (index: number) => void }
  playlist?: {
    id: number
    entryIds: number[]
    onRemoved: () => Promise<void>
  }
}

export function SongList({ tracks, playlist, localPlayback }: SongListProps) {
  if (tracks.length === 0) return null
  const playbackTracks: Track[] = localPlayback
    ? tracks.map((track, index) => ({ ...track, playback: { source: 'local', quality: localPlayback.qualities[index] } }))
    : tracks
  return (
    <div className="track-list flex flex-col gap-0.5">
      {playbackTracks.map((t, i) => (
        <SongRow
          key={`${t.uid}-${i}`}
          track={t}
          queue={playbackTracks}
          index={i}
          localPlayback={localPlayback ? { quality: localPlayback.qualities[i], onRemove: () => localPlayback.onRemove(i) } : undefined}
          playlistEntry={playlist ? {
            playlistId: playlist.id,
            entryId: playlist.entryIds[i],
            onRemoved: playlist.onRemoved,
          } : undefined}
        />
      ))}
    </div>
  )
}
