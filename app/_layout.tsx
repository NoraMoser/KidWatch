import { Stack, router } from 'expo-router'
import { useEffect, useState } from 'react'
import { View, ActivityIndicator, TouchableOpacity, Text } from 'react-native'
import { supabase } from '../lib/supabase'
import { Linking } from 'react-native'

export default function RootLayout() {
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Linking.getInitialURL().then((url) => console.log('initial URL:', url))
    const sub = Linking.addEventListener('url', ({ url }) => console.log('URL event:', url))
    return () => sub.remove()
  }, [])
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace('/(auth)/login')
      }
      setLoading(false)
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

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    )
  }

  return (
    <Stack>
      <Stack.Screen name="(auth)/login" options={{ headerShown: false }} />
      <Stack.Screen
        name="index"
        options={{
          title: 'KidWatch',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.push('/settings')} style={{ marginRight: 8 }}>
              <Text style={{ fontSize: 22 }}>⚙️</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <Stack.Screen name="channel/[id]" options={{ title: 'Videos' }} />
      <Stack.Screen name="video/[id]" options={{ title: 'Summary' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="oauth" options={{ headerShown: false }} />
    </Stack>
  )
}
