import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { youtubeVideoId, videoTitle } = await req.json()
    const ytKey = Deno.env.get('YOUTUBE_API_KEY') ?? ''

    // Fetch comments from YouTube
    const commentsRes = await fetch(
      `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${youtubeVideoId}&maxResults=100&order=relevance&key=${ytKey}`
    )
    const commentsData = await commentsRes.json()
    console.log('comments response:', JSON.stringify(commentsData).slice(0, 200))

    if (!commentsData.items || commentsData.items.length === 0) {
      return new Response(JSON.stringify({ success: true, comments: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const comments = commentsData.items.map((item: any) => ({
      youtube_comment_id: item.id,
      author: item.snippet.topLevelComment.snippet.authorDisplayName,
      text: item.snippet.topLevelComment.snippet.textDisplay,
      like_count: item.snippet.topLevelComment.snippet.likeCount,
      published_at: item.snippet.topLevelComment.snippet.publishedAt,
    }))

    // Ask Claude to flag concerning comments
    const commentList = comments
      .map((c: any, i: number) => `${i + 1}. [${c.author}]: ${c.text}`)
      .join('\n')

    const prompt = `You are reviewing YouTube comments on a video made by a child (age 9-11) called "${videoTitle}".

Here are the comments:
${commentList.slice(0, 4000)}

For each comment, determine if it is concerning for a parent to know about. Concerning comments include:
- Inappropriate language or sexual content
- Bullying, harassment, or mean comments directed at the child
- Adults making suspicious or overly personal comments
- Requests to contact the child privately
- Anything that feels off or predatory

Respond with ONLY a JSON array:
[
  {
    "youtube_comment_id": "the comment id",
    "flagged": true or false,
    "flag_reason": "brief reason if flagged, null if not"
  }
]`

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const claudeData = await claudeRes.json()
    const text = claudeData.content?.[0]?.text || ''
    const jsonMatch = text
      .replace(/```json|```/g, '')
      .trim()
      .match(/\[[\s\S]*\]/)
    if (!jsonMatch) throw new Error('Could not parse Claude response')
    const flagged = JSON.parse(jsonMatch[0])

    // Merge flag data into comments
    const flagMap: Record<string, any> = {}
    flagged.forEach((f: any) => {
      flagMap[f.youtube_comment_id] = f
    })

    const result = comments.map((c: any) => ({
      ...c,
      flagged: flagMap[c.youtube_comment_id]?.flagged ?? false,
      flag_reason: flagMap[c.youtube_comment_id]?.flag_reason ?? null,
    }))

    return new Response(JSON.stringify({ success: true, comments: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
