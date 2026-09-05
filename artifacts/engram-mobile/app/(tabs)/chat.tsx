import { Feather } from "@expo/vector-icons";
import { fetch as expoFetch } from "expo/fetch";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/ui";
import { useEngram } from "@/context/engram-context";
import { useColors } from "@/hooks/useColors";
import {
  getGetEngramQueryKey,
  getGetOpenaiConversationQueryKey,
  useCreateOpenaiConversation,
  useGetEngram,
  useGetOpenaiConversation,
} from "@workspace/api-client-react";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

let messageCounter = 0;
function uid(): string {
  messageCounter += 1;
  return `m-${Date.now()}-${messageCounter}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

import { isOfflineMode, useOfflineMode } from "@/lib/offline/mode";
import { sendOfflineMessage } from "@/lib/offline/chat";
import { getArchivalConversationId } from "@/lib/offline/store";
import { resolveReplyLanguage } from "@/lib/i18n";
import { isRtlLanguage } from "@/lib/layout-direction";
import { OFFLINE_LIMITS } from "@/lib/offline/limits";
import { resolveServerApiUrl } from "@/lib/server-url";

export default function ChatScreen() {
  const { t, i18n } = useTranslation("mobile");
  const rtl = isRtlLanguage(i18n.resolvedLanguage ?? i18n.language);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { selectedEngramId, getConversationId, setConversationId } = useEngram();
  // Conversation IDs are backend-specific; re-resolve when the mode flips.
  const offlineActive = useOfflineMode();

  const enabled = selectedEngramId != null;
  const engramId = selectedEngramId ?? 0;

  const { data: engram } = useGetEngram(engramId, {
    query: { enabled, queryKey: getGetEngramQueryKey(engramId) },
  });

  const [conversationId, setLocalConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showTyping, setShowTyping] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const initializedRef = useRef(false);

  const createConversation = useCreateOpenaiConversation();

  // Resolve / create the conversation for the selected engram.
  useEffect(() => {
    if (!enabled) return;
    let canceled = false;
    initializedRef.current = false;
    setMessages([]);
    const existing = getConversationId(engramId);
    if (existing != null) {
      setLocalConversationId(existing);
      return;
    }
    setLocalConversationId(null);
    void (async () => {
      if (offlineActive) {
        const archivalConversationId =
          await getArchivalConversationId(engramId);
        if (archivalConversationId != null) {
          if (canceled) return;
          setConversationId(engramId, archivalConversationId);
          setLocalConversationId(archivalConversationId);
          return;
        }
      }
      const convo = await createConversation.mutateAsync({
        data: {
          title: t("chat.sessionTitle", {
            name: engram?.name ?? t("chat.engramFallback"),
          }),
          mode: "companion",
          engramId,
        },
      });
      if (canceled) return;
      setConversationId(engramId, convo.id);
      setLocalConversationId(convo.id);
      initializedRef.current = true;
    })().catch(() => {});
    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engramId, enabled, offlineActive]);

  const { data: conversation } = useGetOpenaiConversation(conversationId ?? 0, {
    query: {
      enabled: conversationId != null,
      queryKey: getGetOpenaiConversationQueryKey(conversationId ?? 0),
    },
  });

  // Hydrate history once per conversation.
  useEffect(() => {
    if (conversation?.messages && !initializedRef.current) {
      setMessages(
        conversation.messages.map((m) => ({
          id: String(m.id),
          role: m.role === "user" ? "user" : "assistant",
          content: m.content,
        })),
      );
      initializedRef.current = true;
    }
  }, [conversation?.messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (text.length === 0 || isStreaming || conversationId == null) return;

    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }

    const userMessageId = uid();
    setInput("");
    setMessages((prev) => [
      ...prev,
      { id: userMessageId, role: "user", content: text },
    ]);
    setIsStreaming(true);
    setShowTyping(true);

    let full = "";
    let assistantAdded = false;
    let assistantMessageId: string | null = null;
    let updateTimer: ReturnType<typeof setTimeout> | null = null;

    const renderStream = () => {
      updateTimer = null;
      if (!assistantAdded) {
        setShowTyping(false);
        assistantMessageId = uid();
        setMessages((prev) => [
          ...prev,
          { id: assistantMessageId!, role: "assistant", content: full },
        ]);
        assistantAdded = true;
      } else {
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { ...next[next.length - 1], content: full };
          return next;
        });
      }
    };
    const pushToken = (delta: string) => {
      full += delta;
      if (updateTimer == null) {
        updateTimer = setTimeout(renderStream, 50);
      }
    };
    const flushStream = () => {
      if (updateTimer != null) {
        clearTimeout(updateTimer);
        updateTimer = null;
      }
      if (full.length > 0) renderStream();
    };

    // On-device offline mode: stream from the local model, no network.
    if (isOfflineMode()) {
      try {
        await sendOfflineMessage({
          conversationId,
          engramId,
          content: text,
          onToken: pushToken,
        });
      } catch {
        flushStream();
        setShowTyping(false);
        setMessages((prev) => [
          ...prev.filter(
            (message) =>
              message.id !== userMessageId &&
              message.id !== assistantMessageId,
          ),
          {
            id: uid(),
            role: "assistant",
            content: t("chat.offlineUnavailable"),
          },
        ]);
        setInput(text);
      } finally {
        flushStream();
        setIsStreaming(false);
        setShowTyping(false);
      }
      return;
    }

    try {
      const streamUrl = await resolveServerApiUrl(
        `/api/openai/conversations/${conversationId}/messages`,
      );
      const response = await expoFetch(streamUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          content: text,
          language: await resolveReplyLanguage(),
        }),
      });

      if (!response.ok) throw new Error("stream failed");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("no body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]" || data.length === 0) continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.done) continue;
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.content) pushToken(parsed.content);
          } catch {
            // skip malformed line
          }
        }
      }
    } catch {
      flushStream();
      setShowTyping(false);
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          content: t("chat.signalInterrupted"),
        },
      ]);
    } finally {
      flushStream();
      setIsStreaming(false);
      setShowTyping(false);
    }
  }, [input, isStreaming, conversationId, engramId, t]);

  if (!enabled) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={{ paddingTop: insets.top }} />
        <EmptyState
          icon={
            <Feather
              name="message-circle"
              size={28}
              color={colors.mutedForeground}
            />
          }
          title={t("chat.noEngram")}
          subtitle={t("chat.noEngramSubtitle")}
        />
      </View>
    );
  }

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const reversed = [...messages].reverse();
  const archivalReadOnly = engram?.isArchival === true;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 12,
            borderBottomColor: colors.border,
            backgroundColor: colors.background,
          },
        ]}
      >
        <Text style={[styles.kicker, rtl && styles.rtlText, { color: colors.primary }]}>
          {t("chat.kicker")} // {engram?.symbol ?? "··"}
        </Text>
        <Text style={[styles.h1, rtl && styles.rtlText, { color: colors.foreground }]}>
          {engram?.name ?? t("chat.fallbackTitle")}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        <FlatList
          data={reversed}
          keyExtractor={(item) => item.id}
          inverted={messages.length > 0}
          contentContainerStyle={styles.listContent}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            showTyping ? (
              <View style={styles.typingRow}>
                <View
                  style={[
                    styles.bubble,
                    styles.assistantBubble,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <ActivityIndicator color={colors.primary} size="small" />
                </View>
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const isUser = item.role === "user";
            return (
              <View
                style={[
                  styles.bubbleRow,
                  { justifyContent: isUser ? "flex-end" : "flex-start" },
                ]}
              >
                <View
                  style={[
                    styles.bubble,
                    isUser
                      ? { backgroundColor: colors.primary }
                      : {
                          backgroundColor: colors.card,
                          borderColor: colors.border,
                          borderWidth: 1,
                        },
                  ]}
                >
                  <Text
                    style={{
                      fontFamily: "Inter_400Regular",
                      fontSize: 15,
                      lineHeight: 22,
                      color: isUser
                        ? colors.primaryForeground
                        : colors.foreground,
                      writingDirection: rtl ? "rtl" : "ltr",
                      textAlign: rtl ? "right" : "left",
                    }}
                  >
                    {item.content}
                  </Text>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            !showTyping ? (
              <View style={styles.emptyWrap}>
                <EmptyState
                  icon={
                    <Feather
                      name="radio"
                      size={28}
                      color={colors.mutedForeground}
                    />
                  }
                  title={t("chat.speakWith", {
                    name: engram?.name ?? t("chat.theEngram"),
                  })}
                  subtitle={t("chat.speakSubtitle")}
                />
              </View>
            ) : null
          }
        />

        <View
          style={[
            styles.inputBar,
            {
              paddingBottom: (Platform.OS === "web" ? 34 : insets.bottom) + 8,
              borderTopColor: colors.border,
              backgroundColor: colors.background,
            },
          ]}
        >
          <TextInput
            ref={inputRef}
            value={input}
            onChangeText={setInput}
            placeholder={t("chat.inputPlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            editable={!archivalReadOnly}
            multiline
            maxLength={OFFLINE_LIMITS.maxInputChars}
            blurOnSubmit={false}
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                color: colors.foreground,
                borderRadius: colors.radius,
                opacity: archivalReadOnly ? 0.6 : 1,
                writingDirection: rtl ? "rtl" : "ltr",
                textAlign: rtl ? "right" : "left",
              },
            ]}
          />
          <Pressable
            testID="send-button"
            onPress={() => {
              handleSend();
              inputRef.current?.focus();
            }}
            disabled={
              archivalReadOnly || isStreaming || input.trim().length === 0
            }
            style={({ pressed }) => [
              styles.send,
              {
                backgroundColor: colors.primary,
                borderRadius: colors.radius,
                opacity:
                  archivalReadOnly || isStreaming || input.trim().length === 0
                    ? 0.4
                    : pressed
                      ? 0.8
                      : 1,
              },
            ]}
          >
            <Feather name="arrow-up" size={22} color={colors.primaryForeground} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    gap: 4,
  },
  kicker: {
    fontFamily: "JetBrainsMono_500Medium",
    fontSize: 11,
    letterSpacing: 2,
  },
  h1: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 28,
    letterSpacing: 0.5,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexGrow: 1,
  },
  bubbleRow: {
    flexDirection: "row",
    marginBottom: 10,
  },
  typingRow: {
    flexDirection: "row",
    marginBottom: 10,
  },
  bubble: {
    maxWidth: "82%",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  assistantBubble: {
    borderWidth: 1,
  },
  emptyWrap: {
    flex: 1,
    minHeight: 360,
    transform: [{ scaleY: -1 }],
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    maxHeight: 120,
    fontFamily: "Inter_400Regular",
    fontSize: 15,
  },
  send: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  rtlText: {
    writingDirection: "rtl",
    textAlign: "right",
    letterSpacing: 0,
  },
});
