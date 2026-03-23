import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Linking,
} from 'react-native'
import { useEffect, useState, useRef } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { supabase } from '../../lib/supabase'
import type { Video, Summary, Comment } from '../../lib/types'

type Tab = 'summary' | 'flags' | 'talking' | 'comments'

export default function VideoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [video, setVideo] = useState<Video | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [tab, setTab] = useState<Tab>('summary')
  const [processing, setProcessing] = useState(false)
  const [step, setStep] = useState(0)
  const [progress, setProgress] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentsLoaded, setCommentsLoaded] = useState(false)

  const steps = [
    { label: 'Fetching transcript', emoji: '📡' },
    { label: 'Reading the content', emoji: '🧠' },
    { label: 'Writing summary', emoji: '✍️' },
    { label: 'Finding talking points', emoji: '🚩' },
  ]

  useEffect(() => {
    loadVideo()
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [id])

  async function loadVideo() {
    const { data: v } = await supabase.from('videos').select('*').eq('id', id).single()
    if (!v) return
    setVideo(v)
    await supabase.from('videos').update({ seen: true }).eq('id', id)
    const { data: s } = await supabase.from('summaries').select('*').eq('video_id', id).single()
    if (s) {
      setSummary(s)
    } else {
      startProcessing(v)
    }
  }

  function startProcessing(v: Video) {
    setProcessing(true)
    setProgress(0)
    setStep(0)
    const total = 60
    let elapsed = 0
    intervalRef.current = setInterval(() => {
      elapsed++
      const pct = Math.min(90, (elapsed / total) * 90)
      setProgress(pct)
      if (pct > 20) setStep(1)
      if (pct > 45) setStep(2)
      if (pct > 70) setStep(3)
    }, 1000)
    summarizeVideo(v)
  }

  async function summarizeVideo(v: Video) {
    try {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
      }

      const submitRes = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/summarize-video`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            videoId: v.id,
            videoTitle: v.title,
            videoDescription: v.description,
            youtubeVideoId: v.youtube_video_id,
          }),
        }
      )

      const submitResult = await submitRes.json()
      console.log('submit result:', JSON.stringify(submitResult))
      if (!submitResult.success) throw new Error(submitResult.error)

      if (submitResult.status === 'no_transcript') {
        await summarizeWithTitleOnly(v, headers)
        return
      }

      const jobId = submitResult.jobId
      let attempts = 0
      while (attempts < 24) {
        await new Promise((resolve) => setTimeout(resolve, 5000))
        attempts++
        const checkRes = await fetch(
          `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/check-transcript`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              jobId,
              videoId: v.id,
              videoTitle: v.title,
              videoDescription: v.description,
            }),
          }
        )
        const checkResult = await checkRes.json()
        console.log('check result status:', checkResult.status)
        if (checkResult.status === 'completed') {
          await saveSummary(v, checkResult.data)
          return
        }
        if (checkResult.status === 'error') {
          await summarizeWithTitleOnly(v, headers)
          return
        }
      }
      await summarizeWithTitleOnly(v, headers)
    } catch (e: any) {
      console.log('summarize error:', e.message)
      if (intervalRef.current) clearInterval(intervalRef.current)
      setProcessing(false)
    }
  }

  async function summarizeWithTitleOnly(v: Video, headers: any) {
    const res = await fetch(
      `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/check-transcript`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jobId: null,
          videoId: v.id,
          videoTitle: v.title,
          videoDescription: v.description,
          skipTranscript: true,
        }),
      }
    )
    const result = await res.json()
    if (result.data) await saveSummary(v, result.data)
  }

  async function saveSummary(v: Video, parsed: any) {
    const { data: saved, error: saveError } = await supabase
      .from('summaries')
      .insert({
        video_id: v.id,
        summary: parsed.summary,
        green_flags: parsed.green_flags,
        red_flags: parsed.red_flags,
        talking_points: parsed.talking_points,
      })
      .select()
      .single()
    console.log('save error:', saveError)
    if (intervalRef.current) clearInterval(intervalRef.current)
    setProgress(100)
    setTimeout(() => {
      setProcessing(false)
      if (saved) setSummary(saved)
    }, 600)
  }

  async function loadComments() {
    if (commentsLoaded) return
    setCommentsLoading(true)

    const { data: existing } = await supabase
      .from('comments')
      .select('*')
      .eq('video_id', id)
      .order('like_count', { ascending: false })

    if (existing && existing.length > 0) {
      setComments(existing)
      setCommentsLoaded(true)
      setCommentsLoading(false)
      return
    }

    if (!video) return

    const res = await fetch(
      `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/analyze-comments`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          youtubeVideoId: video.youtube_video_id,
          videoTitle: video.title,
        }),
      }
    )

    const result = await res.json()
    console.log('comments result:', result.success, result.comments?.length)

    if (result.success && result.comments?.length > 0) {
      const toInsert = result.comments.map((c: any) => ({ ...c, video_id: id }))
      const { data: saved } = await supabase
        .from('comments')
        .upsert(toInsert, { onConflict: 'youtube_comment_id' })
        .select()
      if (saved) setComments(saved)
    }

    setCommentsLoaded(true)
    setCommentsLoading(false)
  }

  if (!video) return <ActivityIndicator style={{ flex: 1 }} />

  if (processing) {
    return (
      <View style={styles.container}>
        <View style={styles.processingVideoMeta}>
          {video.thumbnail_url && (
            <Image source={{ uri: video.thumbnail_url }} style={styles.processingThumb} />
          )}
          <Text style={styles.processingVideoTitle} numberOfLines={2}>
            {video.title}
          </Text>
        </View>
        <View style={styles.processingContent}>
          <Text style={styles.processingIcon}>🔍</Text>
          <Text style={styles.processingTitle}>Reviewing this video for you</Text>
          <Text style={styles.processingSub}>Takes about 30–60 seconds</Text>
          <View style={styles.stepsList}>
            {steps.map((s, i) => (
              <View
                key={i}
                style={[
                  styles.stepItem,
                  i < step && styles.stepDone,
                  i === step && styles.stepActive,
                ]}
              >
                <Text style={styles.stepEmoji}>{s.emoji}</Text>
                <Text style={styles.stepLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
          <Text style={styles.progressLabel}>
            {progress < 90 ? `${Math.round(progress)}% done` : 'Almost there…'}
          </Text>
        </View>
      </View>
    )
  }

  if (!summary) return null

  const flaggedComments = comments.filter((c) => c.flagged)
  const normalComments = comments.filter((c) => !c.flagged)

  return (
    <View style={styles.container}>
      <View style={styles.videoMeta}>
        {video.thumbnail_url && (
          <Image source={{ uri: video.thumbnail_url }} style={styles.thumb} />
        )}
        <View style={styles.metaInfo}>
          <Text style={styles.videoTitle} numberOfLines={2}>
            {video.title}
          </Text>
          <TouchableOpacity
            onPress={() => Linking.openURL(`https://youtube.com/watch?v=${video.youtube_video_id}`)}
          >
            <Text style={styles.watchLink}>Watch on YouTube →</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.tabBar}>
        {(['summary', 'flags', 'talking', 'comments'] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
            onPress={() => {
              setTab(t)
              if (t === 'comments') loadComments()
            }}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'summary'
                ? 'Summary'
                : t === 'flags'
                  ? 'Flags'
                  : t === 'talking'
                    ? 'Talking'
                    : 'Comments'}
            </Text>
            {t === 'flags' && summary.red_flags?.length > 0 && <View style={styles.redDot} />}
            {t === 'comments' && flaggedComments.length > 0 && <View style={styles.redDot} />}
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.tabContent} contentContainerStyle={{ padding: 20 }}>
        {tab === 'summary' && <Text style={styles.summaryText}>{summary.summary}</Text>}

        {tab === 'flags' && (
          <View style={styles.flagsContainer}>
            <Text style={styles.flagsHeader}>✓ Green flags</Text>
            {(summary.green_flags || []).length === 0 ? (
              <Text style={styles.emptyFlags}>Nothing noted.</Text>
            ) : (
              (summary.green_flags || []).map((f, i) => (
                <View key={i} style={[styles.flagItem, styles.flagGreen]}>
                  <Text style={styles.flagDot}>●</Text>
                  <Text style={styles.flagTextGreen}>{f}</Text>
                </View>
              ))
            )}
            <Text style={[styles.flagsHeader, { marginTop: 24 }]}>⚑ Worth a conversation</Text>
            {(summary.red_flags || []).length === 0 ? (
              <Text style={styles.emptyFlags}>Nothing flagged. Looks good.</Text>
            ) : (
              (summary.red_flags || []).map((f, i) => (
                <View key={i} style={[styles.flagItem, styles.flagRed]}>
                  <Text style={styles.flagDot}>●</Text>
                  <Text style={styles.flagTextRed}>{f}</Text>
                </View>
              ))
            )}
          </View>
        )}

        {tab === 'talking' && (
          <View style={styles.talkingPoints}>
            {(summary.talking_points || []).map((p: any, i: number) => (
              <View key={i} style={styles.talkingPoint}>
                <Text style={styles.talkingLabel}>{p.label}</Text>
                <Text style={styles.talkingText}>{p.point}</Text>
              </View>
            ))}
          </View>
        )}

        {tab === 'comments' && (
          <View>
            {commentsLoading ? (
              <View style={{ alignItems: 'center', paddingTop: 40, gap: 12 }}>
                <ActivityIndicator />
                <Text style={styles.emptyFlags}>Scanning comments…</Text>
              </View>
            ) : comments.length === 0 ? (
              <Text style={styles.emptyFlags}>No comments found.</Text>
            ) : (
              <View style={styles.talkingPoints}>
                {flaggedComments.length > 0 && (
                  <View style={{ marginBottom: 16 }}>
                    <Text style={styles.flagsHeader}>⚑ Flagged comments</Text>
                    {flaggedComments.map((c, i) => (
                      <View key={i} style={[styles.flagItem, styles.flagRed]}>
                        <View style={{ flex: 1 }}>
                          <Text
                            style={[styles.flagTextRed, { fontWeight: '600', marginBottom: 2 }]}
                          >
                            {c.author}
                          </Text>
                          <Text style={styles.flagTextRed}>{c.text}</Text>
                          {c.flag_reason && (
                            <Text
                              style={[
                                styles.flagTextRed,
                                { fontSize: 12, marginTop: 4, opacity: 0.8 },
                              ]}
                            >
                              {c.flag_reason}
                            </Text>
                          )}
                        </View>
                      </View>
                    ))}
                  </View>
                )}
                <Text style={styles.flagsHeader}>All comments</Text>
                {normalComments.map((c, i) => (
                  <View key={i} style={styles.talkingPoint}>
                    <Text style={styles.talkingLabel}>{c.author}</Text>
                    <Text style={styles.talkingText}>{c.text}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAF7F2' },
  videoMeta: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E0D4',
  },
  thumb: { width: 120, height: 68, borderRadius: 8 },
  metaInfo: { flex: 1, justifyContent: 'space-between' },
  videoTitle: { fontSize: 14, fontWeight: '500', color: '#1C1A17', lineHeight: 20 },
  watchLink: { fontSize: 13, color: '#C4593A' },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#E8E0D4' },
  tabBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
  },
  tabBtnActive: { borderBottomColor: '#C4593A' },
  tabText: { fontSize: 11, color: '#8C857C', fontWeight: '500' },
  tabTextActive: { color: '#1C1A17' },
  redDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#C4593A', marginTop: 1 },
  tabContent: { flex: 1 },
  summaryText: { fontSize: 15, lineHeight: 26, color: '#4A4540' },
  flagsContainer: {},
  flagsHeader: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: '#8C857C',
    marginBottom: 10,
  },
  flagItem: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 8, marginBottom: 8 },
  flagGreen: { backgroundColor: '#D6EDE3' },
  flagRed: { backgroundColor: '#F0E0D8' },
  flagDot: { fontSize: 8, marginTop: 4 },
  flagTextGreen: { flex: 1, fontSize: 14, color: '#3A7D5C', lineHeight: 20 },
  flagTextRed: { flex: 1, fontSize: 14, color: '#C4593A', lineHeight: 20 },
  emptyFlags: { fontSize: 14, color: '#8C857C' },
  talkingPoints: { gap: 12 },
  talkingPoint: {
    padding: 16,
    backgroundColor: '#F2EDE4',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#C4593A',
  },
  talkingLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: '#C4593A',
    marginBottom: 6,
  },
  talkingText: { fontSize: 14, color: '#4A4540', lineHeight: 20 },
  processingVideoMeta: {
    padding: 16,
    flexDirection: 'row',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E0D4',
    alignItems: 'center',
  },
  processingThumb: { width: 100, height: 56, borderRadius: 6 },
  processingVideoTitle: { flex: 1, fontSize: 14, fontWeight: '500', color: '#1C1A17' },
  processingContent: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  processingIcon: { fontSize: 40, marginBottom: 16 },
  processingTitle: { fontSize: 20, fontWeight: '600', color: '#1C1A17', marginBottom: 6 },
  processingSub: { fontSize: 14, color: '#8C857C', marginBottom: 32 },
  stepsList: { width: '100%', gap: 10, marginBottom: 32 },
  stepItem: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#F2EDE4',
    alignItems: 'center',
  },
  stepDone: { backgroundColor: '#D6EDE3' },
  stepActive: { backgroundColor: '#F5ECD0' },
  stepEmoji: { fontSize: 16 },
  stepLabel: { fontSize: 14, color: '#4A4540' },
  progressTrack: {
    width: '100%',
    height: 6,
    backgroundColor: '#E8E0D4',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: { height: '100%', backgroundColor: '#C4593A', borderRadius: 3 },
  progressLabel: { fontSize: 13, color: '#8C857C' },
})
