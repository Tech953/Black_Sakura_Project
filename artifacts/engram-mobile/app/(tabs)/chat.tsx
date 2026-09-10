import { Feather } from "@expo/vector-icons";
import { fetch as expoFetch } from "expo/fetch";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
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
  getListOpenaiConversationsQueryKey,
  useArchiveOpenaiConversation,
  useCreateOpenaiConversation,
  useGetEngram,
  useGetOpenaiConversation,
  useListOpenaiConversations,
} from "@workspace/api-client-react";
import type { OpenaiConversation } from "@workspace/api-client-react";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  speakerEngramId?: number | null;
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
import {
  buildMarkdownTranscript,
  buildPlainTextTranscript,
  buildTranscriptEntries,
} from "@/lib/chat-export";
import { exportNativeChatConversation } from "@/lib/native-chat-export";
import {
  buildWebChatExport,
  downloadWebChatExport,
} from "@/lib/web-chat-export";

export default function ChatScreen() {
  const { t, i18n } = useTranslation("mobile");
  const rtl = isRtlLanguage(i18n.resolvedLanguage ?? i18n.language);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    selectedEngramId,
    getConversationId,
    setConversationId,
    setSelectedEngramId,
  } = useEngram();
  const queryClient = useQueryClient();
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const initializedRef = useRef(false);

  const createConversation = useCreateOpenaiConversation();
  const archiveConversation = useArchiveOpenaiConversation();
  const { data: history, isLoading: historyLoading } =
    useListOpenaiConversations(
      { archived: showArchived },
      {
        query: {
          enabled: historyOpen,
          queryKey: getListOpenaiConversationsQueryKey({
            archived: showArchived,
          }),
        },
      },
    );

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
          createdAt: m.createdAt,
          speakerEngramId: m.speakerEngramId,
        })),
      );
      initializedRef.current = true;
    }
  }, [conversation?.messages]);

  const selectHistoryConversation = useCallback(
    (selected: OpenaiConversation) => {
      initializedRef.current = false;
      setMessages([]);
      setLocalConversationId(selected.id);
      if (selected.engramId != null) {
        setConversationId(selected.engramId, selected.id);
        setSelectedEngramId(selected.engramId);
      }
      setHistoryOpen(false);
      void queryClient.invalidateQueries({
        queryKey: getGetOpenaiConversationQueryKey(selected.id),
      });
    },
    [queryClient, setConversationId, setSelectedEngramId],
  );

  const handleArchiveConversation = useCallback(
    async (selected: Pick<OpenaiConversation, "id">, archived = !showArchived) => {
      try {
        await archiveConversation.mutateAsync({
          id: selected.id,
          data: { archived },
        });
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: getListOpenaiConversationsQueryKey({ archived: false }),
          }),
          queryClient.invalidateQueries({
            queryKey: getListOpenaiConversationsQueryKey({ archived: true }),
          }),
          queryClient.invalidateQueries({
            queryKey: getGetOpenaiConversationQueryKey(selected.id),
          }),
        ]);
      } catch {
        // Leave the history sheet open; the next refresh shows the unchanged state.
      }
    },
    [archiveConversation, queryClient, showArchived],
  );

  const handleExport = useCallback(
    async (format: "md" | "txt" | "pdf" | "docx") => {
      if (!conversation || messages.length === 0) return;
      setExporting(true);
      try {
        const title = conversation.title ?? t("chat.fallbackTitle");
        const exportedAt = new Date().toISOString();
        const entries = buildTranscriptEntries(messages, {
          you: t("chat.you"),
          perceivedContext: t("chat.perceivedContext"),
          engramFallback: t("chat.engramFallback"),
          speakerName: () => engram?.name ?? t("chat.engramFallback"),
          defaultAssistant: engram?.name ?? t("chat.engramFallback"),
        });
        const safeTitle =
          title
            .trim()
            .replace(/[^\w.-]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 80) || "engram-chat";
        const exportInput = {
          title,
          downloadedOn: t("chat.exportedOn"),
          exportedAt,
          conversationCreated: t("chat.conversationCreated"),
          createdAt: conversation.createdAt,
          entries,
        };
        if (Platform.OS === "web") {
          downloadWebChatExport(
            await buildWebChatExport(format, exportInput, safeTitle),
          );
          return;
        }
        const fallback =
          format === "md"
            ? buildMarkdownTranscript(exportInput)
            : buildPlainTextTranscript(exportInput);
        if (!(await Sharing.isAvailableAsync())) {
          await Share.share({ title, message: fallback });
          return;
        }

        await exportNativeChatConversation(format, exportInput, safeTitle, {
          cacheDirectory: FileSystem.cacheDirectory ?? "",
          writeAsStringAsync: (uri, contents, options) =>
            FileSystem.writeAsStringAsync(uri, contents, {
              encoding:
                options.encoding === "base64"
                  ? FileSystem.EncodingType.Base64
                  : FileSystem.EncodingType.UTF8,
            }),
          printToFileAsync: ({ html }) => Print.printToFileAsync({ html }),
          getInfoAsync: (uri) => FileSystem.getInfoAsync(uri),
          shareAsync: (uri, options) => Sharing.shareAsync(uri, options),
          dialogTitle: t("chat.shareConversation"),
        });
      } finally {
        setExporting(false);
        setExportOpen(false);
      }
    },
    [conversation, engram?.name, messages, t],
  );

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
  const archivalReadOnly =
    engram?.isArchival === true || Boolean(conversation?.archivedAt);

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
        <View style={styles.headerRow}>
          <Text style={[styles.h1, rtl && styles.rtlText, { color: colors.foreground }]}>
            {engram?.name ?? t("chat.fallbackTitle")}
          </Text>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityLabel={t("chat.history")}
              onPress={() => setHistoryOpen(true)}
              style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Feather name="clock" size={18} color={colors.primary} />
            </Pressable>
            <Pressable
              accessibilityLabel={t("chat.exportConversation")}
              disabled={messages.length === 0 || isStreaming}
              onPress={() => setExportOpen(true)}
              style={({ pressed }) => [
                styles.headerButton,
                { opacity: messages.length === 0 || isStreaming ? 0.3 : pressed ? 0.6 : 1 },
              ]}
            >
              <Feather name="download" size={18} color={colors.primary} />
            </Pressable>
            {conversation?.archivedAt && (
              <Pressable
                accessibilityLabel={t("chat.restoreConversation")}
                onPress={() => void handleArchiveConversation(conversation, false)}
                style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Feather name="archive" size={18} color={colors.primary} />
              </Pressable>
            )}
          </View>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
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
      <Modal
        visible={historyOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setHistoryOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setHistoryOpen(false)}
          />
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.modalHeader}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.primary }]}>
                  {t("chat.history")}
                </Text>
                <Text style={[styles.modalHint, { color: colors.mutedForeground }]}>
                  {t("chat.historyHint")}
                </Text>
              </View>
              <Pressable
                accessibilityLabel={t("chat.closeHistory")}
                onPress={() => setHistoryOpen(false)}
              >
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <View style={styles.historyTabs}>
              {([false, true] as const).map((archived) => (
                <Pressable
                  key={String(archived)}
                  onPress={() => setShowArchived(archived)}
                  style={[
                    styles.historyTab,
                    {
                      borderColor: showArchived === archived ? colors.primary : colors.border,
                      backgroundColor: showArchived === archived ? colors.primary + "18" : "transparent",
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: showArchived === archived ? colors.primary : colors.mutedForeground,
                      fontFamily: "JetBrainsMono_500Medium",
                      fontSize: 11,
                      textTransform: "uppercase",
                    }}
                  >
                    {archived ? t("chat.archived") : t("chat.active")}
                  </Text>
                </Pressable>
              ))}
            </View>
            <ScrollView
              contentContainerStyle={styles.historyList}
              showsVerticalScrollIndicator={false}
            >
              {historyLoading ? (
                <ActivityIndicator color={colors.primary} />
              ) : history && history.length > 0 ? (
                history.map((item) => (
                  <View
                    key={item.id}
                    style={[styles.historyItem, { borderColor: colors.border }]}
                  >
                    <Pressable
                      style={styles.historyItemMain}
                      onPress={() => selectHistoryConversation(item)}
                    >
                      <Text
                        numberOfLines={1}
                        style={[styles.historyItemTitle, { color: colors.foreground }]}
                      >
                        {item.title ?? t("chat.fallbackTitle")}
                      </Text>
                      <Text style={[styles.historyItemMeta, { color: colors.mutedForeground }]}>
                        {new Date(item.createdAt).toLocaleDateString()}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel={
                        showArchived
                          ? t("chat.restoreConversation")
                          : t("chat.archiveConversation")
                      }
                      disabled={archiveConversation.isPending}
                      onPress={() => void handleArchiveConversation(item)}
                      style={styles.historyAction}
                    >
                      <Feather
                        name={showArchived ? "archive" : "archive"}
                        size={17}
                        color={colors.primary}
                      />
                    </Pressable>
                  </View>
                ))
              ) : (
                <Text style={[styles.emptyHistory, { color: colors.mutedForeground }]}>
                  {showArchived ? t("chat.noArchived") : t("chat.noHistory")}
                </Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
      <Modal
        visible={exportOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setExportOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setExportOpen(false)}
          />
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.modalHeader}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.primary }]}>
                  {t("chat.exportConversation")}
                </Text>
                <Text style={[styles.modalHint, { color: colors.mutedForeground }]}>
                  {t("chat.exportHint")}
                </Text>
              </View>
              <Pressable
                accessibilityLabel={t("chat.closeExport")}
                onPress={() => setExportOpen(false)}
              >
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>
            {(
              [
                ["md", "downloadMarkdown"],
                ["txt", "downloadText"],
                ["pdf", "downloadPdf"],
                ["docx", "downloadDocx"],
              ] as const
            ).map(([format, label]) => (
              <Pressable
                key={format}
                disabled={exporting}
                onPress={() => void handleExport(format)}
                style={({ pressed }) => [
                  styles.exportOption,
                  {
                    borderColor: colors.border,
                    backgroundColor: pressed ? colors.primary + "18" : colors.background,
                    opacity: exporting ? 0.5 : 1,
                  },
                ]}
              >
                <Feather name="file-text" size={18} color={colors.primary} />
                <Text style={[styles.exportOptionText, { color: colors.foreground }]}>
                  {t(`chat.${label}`)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
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
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
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
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.62)",
  },
  modalCard: {
    maxHeight: "82%",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    marginBottom: 16,
  },
  modalTitle: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 22,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  modalHint: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
    maxWidth: 280,
  },
  historyTabs: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  historyTab: {
    flex: 1,
    borderWidth: 1,
    paddingVertical: 10,
    alignItems: "center",
  },
  historyList: {
    gap: 8,
    paddingBottom: 10,
  },
  historyItem: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
  },
  historyItemMain: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  historyItemTitle: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 16,
  },
  historyItemMeta: {
    fontFamily: "JetBrainsMono_500Medium",
    fontSize: 10,
    marginTop: 3,
  },
  historyAction: {
    width: 46,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
  },
  emptyHistory: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 30,
  },
  exportOption: {
    minHeight: 52,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  exportOptionText: {
    fontFamily: "JetBrainsMono_500Medium",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  rtlText: {
    writingDirection: "rtl",
    textAlign: "right",
    letterSpacing: 0,
  },
});
