import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function callClaude(prompt: string) {
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
  return JSON.parse(jsonMatch[0])
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { jobId, videoTitle, videoDescription, skipTranscript } = await req.json()

    // No transcript path
    if (skipTranscript || !jobId) {
      const prompt = `You are reviewing a YouTube video made by a child (age 9-11) for their parent.

Video title: "${videoTitle}"
Description: "${videoDescription || 'none'}"

No transcript was available. Based on the title and description, give the parent a helpful summary. Be upfront that this is based on limited info.

Respond with ONLY a JSON object, no markdown:
{
  "summary": "...",
  "green_flags": [...],
  "red_flags": [...],
  "talking_points": [{"label": "short topic", "point": "conversation starter"}]
}`
      const parsed = await callClaude(prompt)
      return new Response(JSON.stringify({ success: true, status: 'completed', data: parsed }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Poll AssemblyAI
    const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${jobId}`, {
      headers: { Authorization: Deno.env.get('ASSEMBLYAI_API_KEY') ?? '' },
    })
    const pollData = await pollRes.json()
    console.log('AssemblyAI status:', pollData.status)

    if (pollData.status === 'completed') {
      const transcript = pollData.text || ''
      const prompt = `You are reviewing a YouTube video made by a child (age 9-11) for their parent.

Video title: "${videoTitle}"
Transcript: ${transcript.slice(0, 6000)}

Respond with ONLY a JSON object, no markdown:
{
  "summary": "3-4 warm sentences about what the video is about. Write like you're texting a busy parent.",
  "green_flags": ["positive things — creativity, kindness, impressive skills, things to praise"],
  "red_flags": ["anything worth a conversation — language, risky behavior. Empty array if none."],
  "talking_points": [{"label": "short topic", "point": "A concrete conversation starter the parent could use"}]
}`
      const parsed = await callClaude(prompt)
      return new Response(JSON.stringify({ success: true, status: 'completed', data: parsed }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (pollData.status === 'error') {
      return new Response(JSON.stringify({ success: true, status: 'error' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true, status: 'processing' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
