import { useEffect } from 'react'
import { View, ActivityIndicator } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { supabase } from '../lib/supabase'

export default function OAuthScreen() {
  const params = useLocalSearchParams()

  useEffect(() => {
    console.log('oauth params:', JSON.stringify(params))
    async function handleOAuth() {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const {
        data: { session },
      } = await supabase.auth.getSession()
      console.log('provider_token:', session?.provider_token ? 'YES' : 'NO')
      if (session?.provider_token) {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (user) {
          await supabase
            .from('profiles')
            .update({
              youtube_access_token: session.provider_token,
              youtube_refresh_token: session.provider_refresh_token,
            })
            .eq('id', user.id)
        }
      }
      router.replace('/settings')
    }
    handleOAuth()
  }, [])
  console.log('OAUTH SCREEN LOADED')

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator />
    </View>
  )
}
