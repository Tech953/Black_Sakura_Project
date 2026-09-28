import { Feather } from "@expo/vector-icons";
import { fetch as expoFetch } from "expo/fetch";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useRouter } from "expo-router";
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
import {
  getEngramListModeQueryKey,
  useEngram,
} from "@/context/engram-context";
import { useColors } from "@/hooks/useColors";
import {
  getGetEngramQueryKey,
  getGetOpenaiConversationQueryKey,
  getListOpenaiConversationsQueryKey,
  useArchiveOpenaiConversation,
  useCreateOpenaiConversation,
  useGetEngram,
  useGetOpenaiConversation,
  useListEngrams,
  useListOpenaiConversations,
} from "@workspace/api-client-react";
import type {
  OpenaiConversation,
  OpenaiConversationWithMessages,
} from "@workspace/api-client-react";

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
import {
  getArchivalConversationByEngramSlug,
  getWritableConversationIdForEngramSlug,
} from "@/lib/offline/store";
import { resolveReplyLanguage } from "@/lib/i18n";
import {
  consumeSseChunk,
  flushSseChunk,
  type SseParserState,
} from "@/lib/mobile-flow-seams";
import { isRtlLanguage } from "@/lib/layout-direction";
import { OFFLINE_LIMITS } from "@/lib/offline/limits";
import {
  getServerUrlOverride,
  resolveServerApiUrl,
  subscribeServerUrl,
} from "@/lib/server-url";
import {
  buildMarkdownTranscript,
  buildPlainTextTranscript,
  buildTranscriptEntries,
} from "@/lib/chat-export";
import {
  exportNativeChatConversation,
  getNativeChatExportFailureKind,
  type NativeChatExportDependencies,
  type NativeChatExportFailureKind,
} from "@/lib/native-chat-export";
import {
  buildWebChatExport,
  downloadWebChatExport,
} from "@/lib/web-chat-export";

// Keep this small identity check local: importing the data builder here would
// eagerly pull the full transcript into the chat screen's module graph.
const LIVE_FULL_REZZ_SLUG = "rebecca-full-rezz-live";

const getE2eNativeChatExportDependencies = (): NativeChatExportDependencies | null => {
  if (
    Platform.OS !== "web" ||
    process.env.EXPO_PUBLIC_E2E_NATIVE_EXPORT !== "true"
  ) {
    return null;
  }
  return (
    globalThis as typeof globalThis & {
      __engramNativeChatExportE2E?: NativeChatExportDependencies;
    }
  ).__engramNativeChatExportE2E ?? null;
};

export default function ChatScreen() {
  const { t, i18n } = useTranslation("mobile");
  const rtl = isRtlLanguage(i18n.resolvedLanguage ?? i18n.language);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    selectedEngramId,
    getConversationId,
    setConversationId,
    setSelectedEngramId,
  } = useEngram();
  const queryClient = useQueryClient();
  // Conversation IDs are backend-specific; re-resolve when the mode flips.
  const offlineActive = useOfflineMode();
  const [serverOverride, setServerOverride] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refreshServerOverride = () => {
      void getServerUrlOverride().then((override) => {
        if (active) setServerOverride(override);
      });
    };
    refreshServerOverride();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => subscribeServerUrl(() => {
    void getServerUrlOverride().then(setServerOverride);
  }), []);

  const enabled = selectedEngramId != null;
  const engramId = selectedEngramId ?? 0;

  const { data: engram } = useGetEngram(engramId, {
    query: {
      enabled,
      queryKey: [
        ...getGetEngramQueryKey(engramId),
        offlineActive ? "offline-selection" : "online-selection",
      ],
    },
  });

  const [conversationId, setLocalConversationId] = useState<number | null>(null);
  const [localArchivalConversation, setLocalArchivalConversation] =
    useState<OpenaiConversationWithMessages | null>(null);
  const [conversationResolutionError, setConversationResolutionError] =
    useState<"archive" | "live" | "conversation" | null>(null);
  const [resolutionRetry, setResolutionRetry] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showTyping, setShowTyping] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] =
    useState<NativeChatExportFailureKind | null>(null);
  const inputRef = useRef<TextInput>(null);
  const initializedRef = useRef(false);
  const lastConversationTargetRef = useRef<string | null>(null);

  const createConversation = useCreateOpenaiConversation();
  const archiveConversation = useArchiveOpenaiConversation();
  const resolvingLiveFullRezz =
    !offlineActive && engram?.slug === LIVE_FULL_REZZ_SLUG;
  const {
    data: liveFullRezzHistory,
    isLoading: liveFullRezzHistoryLoading,
    isFetching: liveFullRezzHistoryFetching,
    isError: liveFullRezzHistoryError,
    refetch: refetchLiveFullRezzHistory,
  } = useListOpenaiConversations(
    { archived: false },
    {
      query: {
        enabled: resolvingLiveFullRezz,
        queryKey: getListOpenaiConversationsQueryKey({ archived: false }),
      },
    },
  );
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
  const { data: historyEngrams } = useListEngrams({
    query: {
      queryKey: getEngramListModeQueryKey(offlineActive),
    },
  });

  // Resolve / create the conversation for the selected engram.
  useEffect(() => {
    if (!enabled || !engram) return;
    let canceled = false;
    const targetKey = `${engramId}:${offlineActive}:${engram.slug}:${Boolean(
      engram.isArchival,
    )}`;
    if (lastConversationTargetRef.current !== targetKey) {
      lastConversationTargetRef.current = targetKey;
      initializedRef.current = false;
      setMessages([]);
      setLocalArchivalConversation(null);
      setLocalConversationId(null);
    }
    setConversationResolutionError(null);
    if (
      !offlineActive &&
      engram.slug === LIVE_FULL_REZZ_SLUG &&
      liveFullRezzHistoryFetching
    ) {
      return () => {
        canceled = true;
      };
    }
    void (async () => {
      if (engram.isArchival === true) {
        const original = await getArchivalConversationByEngramSlug(engram.slug);
        if (!original) {
          throw new Error("The preserved transcript is not available locally.");
        }
        if (canceled) return;
        setLocalArchivalConversation(
          original as unknown as OpenaiConversationWithMessages,
        );
        setLocalConversationId(Number(original.id));
        return;
      }

      if (offlineActive) {
        const existing =
          engram.slug === LIVE_FULL_REZZ_SLUG
            ? await getWritableConversationIdForEngramSlug(LIVE_FULL_REZZ_SLUG)
            : getConversationId(engramId);
        if (existing != null) {
          if (canceled) return;
          setConversationId(engramId, existing);
          setLocalConversationId(existing);
          return;
        }
        if (engram.slug === LIVE_FULL_REZZ_SLUG) {
          throw new Error("The saved Full Rezz continuation is missing locally.");
        }
      } else if (engram.slug === LIVE_FULL_REZZ_SLUG) {
        if (liveFullRezzHistoryLoading || liveFullRezzHistoryFetching) return;
        if (liveFullRezzHistoryError) {
          throw new Error("The saved Full Rezz continuation could not be loaded.");
        }
        const existing = liveFullRezzHistory?.find(
          (item) => item.engramId === engramId && !item.archivedAt,
        );
        if (existing) {
          if (canceled) return;
          setConversationId(engramId, existing.id);
          setLocalConversationId(existing.id);
          return;
        }
        throw new Error("The saved Full Rezz continuation is missing.");
      } else {
        const existing = getConversationId(engramId);
        if (existing != null) {
          setLocalConversationId(existing);
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
    })().catch(() => {
      if (canceled) return;
      setConversationResolutionError(
        engram.isArchival === true
          ? "archive"
          : engram.slug === LIVE_FULL_REZZ_SLUG
            ? "live"
            : "conversation",
      );
    });
    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    engramId,
    enabled,
    engram?.slug,
    engram?.isArchival,
    offlineActive,
    liveFullRezzHistory,
    liveFullRezzHistoryFetching,
    liveFullRezzHistoryError,
    resolutionRetry,
  ]);

  const { data: remoteConversation } = useGetOpenaiConversation(conversationId ?? 0, {
    query: {
      enabled: conversationId != null && engram?.isArchival !== true,
      queryKey: getGetOpenaiConversationQueryKey(conversationId ?? 0),
    },
  });
  const conversation =
    engram?.isArchival === true
      ? localArchivalConversation
      : remoteConversation;

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
    async (selected: OpenaiConversation) => {
      const selectedEngram =
        historyEngrams?.find((item) => item.id === selected.engramId) ??
        (engram?.id === selected.engramId ? engram : undefined);
      if (selected.engramId != null && !selectedEngram) return;
      if (selectedEngram?.isArchival === true) {
        setConversationResolutionError(null);
        try {
          const original = await getArchivalConversationByEngramSlug(
            selectedEngram.slug,
          );
          if (!original) {
            setConversationResolutionError("archive");
            setHistoryOpen(false);
            return;
          }
          const localConversation =
            original as unknown as OpenaiConversationWithMessages;
          initializedRef.current = true;
          setMessages(
            localConversation.messages.map((message) => ({
              id: String(message.id),
              role: message.role === "user" ? "user" : "assistant",
              content: message.content,
              createdAt: message.createdAt,
              speakerEngramId: message.speakerEngramId,
            })),
          );
          setLocalArchivalConversation(localConversation);
          setLocalConversationId(Number(original.id));
          setSelectedEngramId(
            selected.engramId!,
            historyEngrams?.find((item) => item.id === selected.engramId)
              ?.slug,
          );
          setHistoryOpen(false);
        } catch {
          setConversationResolutionError("archive");
          setHistoryOpen(false);
        }
        return;
      }

      initializedRef.current = false;
      setMessages([]);
      setLocalArchivalConversation(null);
      setLocalConversationId(selected.id);
      if (selected.engramId != null) {
        setConversationId(selected.engramId, selected.id);
        setSelectedEngramId(
          selected.engramId,
          historyEngrams?.find((item) => item.id === selected.engramId)?.slug,
        );
      }
      setConversationResolutionError(null);
      setHistoryOpen(false);
      void queryClient.invalidateQueries({
        queryKey: getGetOpenaiConversationQueryKey(selected.id),
      });
    },
    [
      engram,
      historyEngrams,
      queryClient,
      setConversationId,
      setSelectedEngramId,
    ],
  );

  const handleArchiveConversation = useCallback(
    async (
      selected: Pick<OpenaiConversation, "id" | "engramId">,
      archived = !showArchived,
    ) => {
      const selectedEngram =
        historyEngrams?.find((item) => item.id === selected.engramId) ??
        (engram?.id === selected.engramId ? engram : undefined);
      if (selected.engramId != null && !selectedEngram) return;
      if (selectedEngram?.isArchival === true) return;
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
    [archiveConversation, engram, historyEngrams, queryClient, showArchived],
  );

  const handleExport = useCallback(
    async (format: "md" | "txt" | "pdf" | "docx") => {
      if (!conversation || messages.length === 0) return;
      setExporting(true);
      setExportError(null);
      let completed = false;
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
        const e2eNativeExport = getE2eNativeChatExportDependencies();
        if (Platform.OS === "web" && !e2eNativeExport) {
          downloadWebChatExport(
            await buildWebChatExport(format, exportInput, safeTitle),
          );
          completed = true;
          return;
        }
        const fallback =
          format === "md"
            ? buildMarkdownTranscript(exportInput)
            : buildPlainTextTranscript(exportInput);
        if (!e2eNativeExport && !(await Sharing.isAvailableAsync())) {
          const result = await Share.share({ title, message: fallback });
          if (result.action === Share.dismissedAction) {
            setExportError("cancelled");
            return;
          }
          completed = true;
          return;
        }

        await exportNativeChatConversation(
          format,
          exportInput,
          safeTitle,
          e2eNativeExport ?? {
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
            deleteAsync: (uri, options) => FileSystem.deleteAsync(uri, options),
            shareAsync: (uri, options) => Sharing.shareAsync(uri, options),
            dialogTitle: t("chat.shareConversation"),
          },
        );
        completed = true;
      } catch (error) {
        setExportError(getNativeChatExportFailureKind(error));
      } finally {
        setExporting(false);
        if (completed) {
          setExportOpen(false);
          setExportError(null);
        }
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
      const parserState: SseParserState = { buffer: "" };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const result = consumeSseChunk(
          parserState,
          decoder.decode(value, { stream: true }),
        );
        result.deltas.forEach(pushToken);
      }
      const trailing = flushSseChunk(parserState);
      trailing.deltas.forEach(pushToken);
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
  const serverMode = offlineActive
    ? "offline"
    : serverOverride
      ? "custom"
      : "builtIn";
  const serverLabel =
    serverMode === "offline"
      ? t("chat.serverOffline")
      : serverMode === "custom"
        ? t("chat.serverCustom")
        : t("chat.serverBuiltIn");

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
              onPress={() => {
                setExportError(null);
                setExportOpen(true);
              }}
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
        {engram?.title ? (
          <Text
            numberOfLines={2}
            style={[
              styles.branchTitle,
              rtl && styles.rtlText,
              { color: colors.mutedForeground },
            ]}
          >
            {engram.title}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole={serverMode === "custom" ? "button" : "text"}
          accessibilityLabel={
            serverMode === "custom" ? t("chat.openServerSettings") : undefined
          }
          disabled={serverMode !== "custom"}
          onPress={() => router.push("/server-settings")}
          style={({ pressed }) => [
            styles.connectionIndicator,
            {
              borderColor: colors.border,
              opacity: serverMode === "custom" && pressed ? 0.65 : 1,
            },
          ]}
        >
          <Feather
            name={serverMode === "offline" ? "smartphone" : "server"}
            size={13}
            color={
              serverMode === "offline"
                ? colors.mutedForeground
                : colors.primary
            }
          />
          <Text
            numberOfLines={1}
            style={[
              styles.connectionIndicatorText,
              rtl && styles.rtlText,
              { color: colors.mutedForeground },
            ]}
          >
            {serverLabel}
          </Text>
          {serverMode === "custom" ? (
            <Feather name="chevron-right" size={13} color={colors.primary} />
          ) : null}
        </Pressable>
        {conversationResolutionError ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("personas.retryConnection")}
            testID="retry-conversation-resolution"
            onPress={() => {
              if (conversationResolutionError === "live" && !offlineActive) {
                void refetchLiveFullRezzHistory();
              }
              setResolutionRetry((attempt) => attempt + 1);
            }}
            style={({ pressed }) => [
              styles.resolutionError,
              { borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
            ]}
          >
            <Feather name="refresh-cw" size={14} color={colors.destructive} />
            <Text
              style={[
                styles.resolutionErrorText,
                rtl && styles.rtlText,
                { color: colors.destructive },
              ]}
            >
              {t("chat.signalInterrupted")}
            </Text>
          </Pressable>
        ) : null}
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
            editable={!archivalReadOnly && conversationId != null}
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
                opacity:
                  archivalReadOnly || conversationId == null ? 0.6 : 1,
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
              archivalReadOnly ||
              conversationId == null ||
              isStreaming ||
              input.trim().length === 0
            }
            style={({ pressed }) => [
              styles.send,
              {
                backgroundColor: colors.primary,
                borderRadius: colors.radius,
                opacity:
                  archivalReadOnly ||
                  conversationId == null ||
                  isStreaming ||
                  input.trim().length === 0
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
                    {item.engramId == null ||
                    historyEngrams?.some(
                      (persona) =>
                        persona.id === item.engramId &&
                        persona.isArchival !== true,
                    ) ? (
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
                          name="archive"
                          size={17}
                          color={colors.primary}
                        />
                      </Pressable>
                    ) : null}
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
        onRequestClose={() => {
          setExportError(null);
          setExportOpen(false);
        }}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              setExportError(null);
              setExportOpen(false);
            }}
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
                onPress={() => {
                  setExportError(null);
                  setExportOpen(false);
                }}
              >
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>
            {exportError && (
              <View
                accessibilityRole="alert"
                style={[
                  styles.exportError,
                  {
                    borderColor: colors.destructive,
                    backgroundColor: colors.destructive + "18",
                  },
                ]}
              >
                <Feather name="alert-circle" size={18} color={colors.destructive} />
                <Text style={[styles.exportErrorText, { color: colors.destructive }]}>
                  {t(
                    exportError === "cancelled"
                      ? "chat.exportCancelled"
                      : "chat.exportFailed",
                  )}
                </Text>
                <Pressable
                  accessibilityLabel={t("chat.dismissExportError")}
                  onPress={() => setExportError(null)}
                >
                  <Feather name="x" size={18} color={colors.destructive} />
                </Pressable>
              </View>
            )}
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
  connectionIndicator: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
    maxWidth: "100%",
  },
  branchTitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 17,
  },
  connectionIndicatorText: {
    fontFamily: "JetBrainsMono_500Medium",
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  resolutionError: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  resolutionErrorText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 17,
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
  exportError: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  exportErrorText: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    lineHeight: 18,
  },
  rtlText: {
    writingDirection: "rtl",
    textAlign: "right",
    letterSpacing: 0,
  },
});
