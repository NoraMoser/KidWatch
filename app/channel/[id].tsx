import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
} from 'react-native'
import { useEffect, useState } from 'react'
import { useLocalSearchParams, router } from 'expo-router'
import { supabase } from '../../lib/supabase'
import type { Channel, Video } from '../../lib/types'

export default function ChannelScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [channel, setChannel] = useState<Channel | null>(null)
  const [videos, setVideos] = useState<Video[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'unseen' | 'seen'>('all')

  useEffect(() => {
    loadChannel()
  }, [id])

  async function loadChannel() {
    const { data: ch } = await supabase.from('channels').select('*').eq('id', id).single()

    if (ch) {
      setChannel(ch)
      await fetchVideos(ch)
    }
    setLoading(false)
  }

  async function fetchVideos(ch: Channel) {
    // First check if we have videos in DB
    const { data: existing } = await supabase
      .from('videos')
      .select('*, summaries(id)')
      .eq('channel_id', ch.id)
      .order('published_at', { ascending: false })

    if (existing && existing.length > 0) {
      setVideos(existing)
      return
    }

    // Fetch from YouTube API
    const apiKey = process.env.EXPO_PUBLIC_YOUTUBE_API_KEY
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${ch.youtube_channel_id}&maxResults=20&order=date&type=video&key=${apiKey}`
    )
    const data = await res.json()
    console.log('YouTube response:', JSON.stringify(data).slice(0, 500))

    if (!data.items) return

    // Get video durations
    const videoIds = data.items.map((i: any) => i.id.videoId).join(',')
    const detailRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoIds}&key=${apiKey}`
    )
    const detailData = await detailRes.json()

    const durationMap: Record<string, number> = {}
    detailData.items?.forEach((item: any) => {
      const iso = item.contentDetails.duration
      const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
      if (match) {
        const h = parseInt(match[1] || '0')
        const m = parseInt(match[2] || '0')
        const s = parseInt(match[3] || '0')
        durationMap[item.id] = h * 3600 + m * 60 + s
      }
    })

    const toInsert = data.items.map((item: any) => ({
      channel_id: ch.id,
      youtube_video_id: item.id.videoId,
      title: item.snippet.title,
      thumbnail_url: item.snippet.thumbnails?.medium?.url,
      published_at: item.snippet.publishedAt,
      duration_seconds: durationMap[item.id.videoId] || null,
      seen: false,
    }))

    const { data: inserted, error: insertError } = await supabase
      .from('videos')
      .upsert(toInsert, { onConflict: 'youtube_video_id' })
      .select()

    console.log('insert error:', insertError)
    console.log('inserted count:', inserted?.length)

    if (inserted) setVideos(inserted)
  }

  function formatDuration(seconds: number | null) {
    if (!seconds) return ''
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${m}:${String(s).padStart(2, '0')}`
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    const days = Math.floor((Date.now() - d.getTime()) / 86400000)
    if (days === 0) return 'Today'
    if (days === 1) return 'Yesterday'
    if (days < 7) return `${days}d ago`
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const filtered = videos.filter((v) => {
    if (filter === 'unseen') return !v.seen
    if (filter === 'seen') return v.seen
    return true
  })

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Loading videos…</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.filterBar}>
        {(['all', 'unseen', 'seen'] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterBtn, filter === f && styles.filterBtnActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(v) => v.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.videoCard, item.seen && styles.videoCardSeen]}
            onPress={() => router.push(`/video/${item.id}`)}
          >
            <View style={styles.thumbContainer}>
              {item.thumbnail_url ? (
                <Image source={{ uri: item.thumbnail_url }} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, styles.thumbPlaceholder]}>
                  <Text style={styles.thumbPlaceholderText}>▶</Text>
                </View>
              )}
              {item.duration_seconds && (
                <View style={styles.duration}>
                  <Text style={styles.durationText}>{formatDuration(item.duration_seconds)}</Text>
                </View>
              )}
              {!item.seen && <View style={styles.newDot} />}
              {(item.summaries?.length ?? 0) > 0 && (
                <View style={styles.reviewedBadge}>
                  <Text style={styles.reviewedText}>✓ Reviewed</Text>
                </View>
              )}
            </View>
            <View style={styles.videoInfo}>
              <Text style={styles.videoTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.videoMeta}>{formatDate(item.published_at)}</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAF7F2' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#8C857C', fontSize: 14 },
  filterBar: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E0D4',
  },
  filterBtn: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E8E0D4',
    backgroundColor: '#fff',
  },
  filterBtnActive: { backgroundColor: '#1C1A17', borderColor: '#1C1A17' },
  filterText: { fontSize: 13, color: '#4A4540' },
  filterTextActive: { color: '#fff' },
  videoCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E8E0D4',
    flexDirection: 'row',
  },
  videoCardSeen: { opacity: 0.6 },
  thumbContainer: { position: 'relative' },
  thumb: { width: 120, height: 80 },
  thumbPlaceholder: {
    backgroundColor: '#E8E0D4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbPlaceholderText: { fontSize: 20, color: '#8C857C' },
  duration: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  durationText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  newDot: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#C4593A',
  },
  videoInfo: { flex: 1, padding: 10, justifyContent: 'space-between' },
  videoTitle: { fontSize: 14, fontWeight: '500', color: '#1C1A17', lineHeight: 20 },
  videoMeta: { fontSize: 12, color: '#8C857C', marginTop: 4 },
  reviewedBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: '#3A7D5C',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  reviewedText: { color: '#fff', fontSize: 10, fontWeight: '600' },
})
