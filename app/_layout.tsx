import { Stack, router } from 'expo-router'
import { useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function RootLayout() {
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace('/(auth)/login')
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        router.replace('/(auth)/login')
      }
      if (event === 'SIGNED_IN') {
        router.replace('/')
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  return (
    <Stack>
      <Stack.Screen name="(auth)/login" options={{ headerShown: false }} />
      <Stack.Screen name="index" options={{ title: 'KidWatch' }} />
      <Stack.Screen name="channel/[id]" options={{ title: 'Videos' }} />
    </Stack>
  )
}
