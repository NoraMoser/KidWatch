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
    const { videoId, videoTitle, videoDescription, youtubeVideoId } = await req.json()

    let transcript = ''
    try {
      const watchRes = await fetch(`https://www.youtube.com/watch?v=${youtubeVideoId}`, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          Cookie: 'CONSENT=YES+1',
        },
      })
      const html = await watchRes.text()
      console.log('watch page length:', html.length)
      console.log('has captionTracks:', html.includes('captionTracks'))

      const playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?})\s*;/)
      console.log('playerResponse match:', playerResponseMatch ? 'found' : 'not found')

      if (playerResponseMatch) {
        const playerData = JSON.parse(playerResponseMatch[1])
        const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks
        console.log('caption tracks:', tracks?.length ?? 0)
        if (tracks?.[0]?.baseUrl) {
          const capRes = await fetch(tracks[0].baseUrl)
          const capXml = await capRes.text()
          const textMatches = capXml.match(/<text[^>]*>([^<]*)<\/text>/g) || []
          transcript = textMatches
            .map((t) =>
              t
                .replace(/<[^>]*>/g, '')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&#39;/g, "'")
                .replace(/&quot;/g, '"')
            )
            .join(' ')
        }
      }
    } catch (e) {
      console.log('transcript error:', e)
    }

    console.log('transcript length:', transcript.length)

    const context = transcript
      ? `Transcript:\n${transcript.slice(0, 6000)}`
      : `Title: "${videoTitle}"\nDescription: "${videoDescription || 'none'}"`

    const prompt = `You are reviewing a YouTube video made by a child (age 9-11) for their parent.

${context}

${transcript ? '' : 'Note: No transcript was available, so base your response on the title and description only. Do not say "without being able to see the content" — just work with what you have.'}

Respond with ONLY a JSON object, no markdown:
{
  "summary": "3-4 warm sentences about what the video is about. Write like you're texting a busy parent.",
  "green_flags": ["positive things — creativity, kindness, impressive skills, things to praise"],
  "red_flags": ["anything worth a conversation — language, risky behavior. Empty array if none."],
  "talking_points": [
    {"label": "short topic", "point": "A concrete conversation starter the parent could use"}
  ]
}`

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const claudeData = await claudeRes.json()
    const text = claudeData.content?.[0]?.text || ''
    const jsonMatch = text
      .replace(/```json|```/g, '')
      .trim()
      .match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Could not parse Claude response')
    const parsed = JSON.parse(jsonMatch[0])

    return new Response(
      JSON.stringify({ success: true, data: parsed, hadTranscript: transcript.length > 0 }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
