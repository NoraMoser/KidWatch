import 'react-native-url-polyfill/auto'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export async function ensureAuth() {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) {
    const { data } = await supabase.auth.signInAnonymously()
    console.log('signed in anonymously:', data.user?.id)
    if (data.user) {
      const { error } = await supabase.from('profiles').upsert({ id: data.user.id })
      console.log('profile upsert error:', error)
    }
  } else {
    console.log('existing session:', session.user.id)
    const { error } = await supabase.from('profiles').upsert({ id: session.user.id })
    console.log('profile upsert error:', error)
  }
}
