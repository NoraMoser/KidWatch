import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useState, useEffect } from "react";
import { router } from "expo-router";
import { supabase, ensureAuth } from "../lib/supabase";
import type { Channel } from "../lib/types";

export default function HomeScreen() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [handle, setHandle] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    ensureAuth().then(() => loadChannels());
    loadChannels();
  }, []);

  async function loadChannels() {
    const { data } = await supabase
      .from("channels")
      .select("*")
      .order("created_at");
    if (data) setChannels(data);
    setFetching(false);
  }

  async function addChannel() {
    if (!handle.trim()) return;
    setLoading(true);

    const apiKey = process.env.EXPO_PUBLIC_YOUTUBE_API_KEY;
    const cleanHandle = handle.trim().replace("@", "");

    try {
      // Resolve handle to channel info via YouTube API
      const searchRes = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${cleanHandle}&key=${apiKey}`,
      );
      const searchData = await searchRes.json();
      const item = searchData.items?.[0];

      if (!item) {
        Alert.alert(
          "Not found",
          "Could not find that channel. Try the full @handle.",
        );
        setLoading(false);
        return;
      }

      const channelId = item.snippet.channelId;
      const title = item.snippet.channelTitle;
      const thumbnail = item.snippet.thumbnails?.default?.url;

      // Check duplicate
      const existing = channels.find((c) => c.youtube_channel_id === channelId);
      if (existing) {
        Alert.alert("Already added", "This channel is already in your list.");
        setLoading(false);
        return;
      }

      // Save to Supabase
      const { data, error } = await supabase
        .from("channels")
        .insert({
          youtube_channel_id: channelId,
          handle: cleanHandle,
          title,
          thumbnail_url: thumbnail,
          user_id: (await supabase.auth.getUser()).data.user?.id,
        })
        .select()
        .single();

      if (error) throw error;

      setChannels((prev) => [...prev, data]);
      setHandle("");
    } catch (e: any) {
      Alert.alert("Error", e.message || "Something went wrong");
    }

    setLoading(false);
  }

  return (
    <View style={styles.container}>
      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          placeholder="@channelhandle"
          placeholderTextColor="#999"
          value={handle}
          onChangeText={setHandle}
          onSubmitEditing={addChannel}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          style={[styles.addBtn, loading && styles.addBtnDisabled]}
          onPress={addChannel}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.addBtnText}>Add</Text>
          )}
        </TouchableOpacity>
      </View>

      {fetching ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : channels.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No channels yet</Text>
          <Text style={styles.emptySub}>
            Add a YouTube @handle above to get started
          </Text>
        </View>
      ) : (
        <FlatList
          data={channels}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.channelCard}
              onPress={() => router.push(`/channel/${item.id}`)}
            >
              <View style={styles.channelAvatar}>
                <Text style={styles.channelInitial}>
                  {(item.title || item.handle || "?")[0].toUpperCase()}
                </Text>
              </View>
              <View style={styles.channelInfo}>
                <Text style={styles.channelName}>
                  {item.title || item.handle}
                </Text>
                <Text style={styles.channelHandle}>@{item.handle}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FAF7F2" },
  addRow: {
    flexDirection: "row",
    padding: 16,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#E8E0D4",
  },
  input: {
    flex: 1,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E8E0D4",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: "#1C1A17",
  },
  addBtn: {
    backgroundColor: "#1C1A17",
    borderRadius: 10,
    paddingHorizontal: 18,
    justifyContent: "center",
  },
  addBtnDisabled: { opacity: 0.5 },
  addBtnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: "600", color: "#4A4540" },
  emptySub: {
    fontSize: 14,
    color: "#8C857C",
    textAlign: "center",
    paddingHorizontal: 40,
  },
  channelCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "#E8E0D4",
  },
  channelAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#E8E0D4",
    alignItems: "center",
    justifyContent: "center",
  },
  channelInitial: { fontSize: 18, fontWeight: "600", color: "#4A4540" },
  channelInfo: { flex: 1 },
  channelName: { fontSize: 15, fontWeight: "600", color: "#1C1A17" },
  channelHandle: { fontSize: 13, color: "#8C857C", marginTop: 2 },
  chevron: { fontSize: 22, color: "#C4593A" },
});
