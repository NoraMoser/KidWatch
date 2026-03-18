export type Profile = {
  id: string
  push_token: string | null
  created_at: string
}

export type Channel = {
  id: string
  user_id: string
  youtube_channel_id: string
  handle: string | null
  title: string | null
  thumbnail_url: string | null
  created_at: string
}

export type Video = {
  id: string
  channel_id: string
  youtube_video_id: string
  title: string | null
  thumbnail_url: string | null
  duration_seconds: number | null
  published_at: string | null
  seen: boolean
  created_at: string
}

export type Summary = {
  id: string
  video_id: string
  summary: string | null
  green_flags: string[]
  red_flags: string[]
  talking_points: { label: string; point: string }[]
  created_at: string
}