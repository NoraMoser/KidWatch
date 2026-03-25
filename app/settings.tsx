import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native'
import { useState, useEffect } from 'react'
import * as WebBrowser from 'expo-web-browser'
import { supabase } from '../lib/supabase'
import { Linking } from 'react-native'

WebBrowser.maybeCompleteAuthSession()

export default function SettingsScreen() {
  const [youtubeConnected, setYoutubeConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    // Handle the OAuth redirect when app comes back to foreground
    const handleUrl = async (url: string) => {
      console.log('deep link received:', url)
      if (url.includes('kidwatch://settings')) {
        // Session should now be updated, check for token
        const {
          data: { session },
        } = await supabase.auth.getSession()
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
            setYoutubeConnected(true)
            Alert.alert('Connected!', 'YouTube account connected successfully!')
          }
        }
      }
    }

    Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url)
    })
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url))
    return () => sub.remove()
  }, [])

  useEffect(() => {
    checkYoutubeConnection()
  }, [])

  async function checkYoutubeConnection() {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase
      .from('profiles')
      .select('youtube_access_token')
      .eq('id', user.id)
      .single()
    setYoutubeConnected(!!data?.youtube_access_token)
    setLoading(false)
  }

  async function connectYoutube() {
    setConnecting(true)
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes:
          'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl',
        redirectTo: 'kidwatch://settings',
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    })

    console.log('oauth data:', JSON.stringify(data))
    console.log('oauth error:', error)

    if (error) {
      Alert.alert('Error', error.message)
      setConnecting(false)
      return
    }

    // Open the URL in browser
    if (data?.url) {
      await WebBrowser.openBrowserAsync(data.url)
    }

    setConnecting(false)
  }

  async function disconnectYoutube() {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase
      .from('profiles')
      .update({
        youtube_access_token: null,
        youtube_refresh_token: null,
      })
      .eq('id', user.id)
    setYoutubeConnected(false)
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  if (loading) return <ActivityIndicator style={{ flex: 1 }} />

  return (
    <View style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>YouTube</Text>
        {youtubeConnected ? (
          <View>
            <View style={styles.connectedRow}>
              <View style={styles.connectedDot} />
              <Text style={styles.connectedText}>YouTube connected</Text>
            </View>
            <TouchableOpacity style={styles.secondaryBtn} onPress={disconnectYoutube}>
              <Text style={styles.secondaryBtnText}>Disconnect</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            <Text style={styles.settingDesc}>
              Connect your child's YouTube account to enable transcript-based summaries.
            </Text>
            <TouchableOpacity
              style={[styles.btn, connecting && styles.btnDisabled]}
              onPress={connectYoutube}
              disabled={connecting}
            >
              {connecting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>Connect YouTube account</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Account</Text>
        <TouchableOpacity style={styles.secondaryBtn} onPress={signOut}>
          <Text style={styles.secondaryBtnText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAF7F2', padding: 20 },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E8E0D4',
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: '#8C857C',
    marginBottom: 12,
  },
  settingDesc: { fontSize: 14, color: '#4A4540', marginBottom: 12, lineHeight: 20 },
  btn: {
    backgroundColor: '#1C1A17',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: '#E8E0D4',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  secondaryBtnText: { color: '#C4593A', fontSize: 15 },
  connectedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  connectedDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3A7D5C' },
  connectedText: { fontSize: 14, color: '#3A7D5C', fontWeight: '500' },
})
