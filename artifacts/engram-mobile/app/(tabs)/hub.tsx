import { Feather } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "@clerk/expo";
import type { UseQueryResult } from "@tanstack/react-query";

import { Chip, EmptyState, MonoLabel, ScoreBar } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { isRtlLanguage } from "@/lib/layout-direction";
import type { EngramMessage, Simulation } from "@workspace/api-client-react";
import {
  getListEngramMessagesQueryKey,
  useGetEngramStates,
  useGetHubControls,
  useListEngramMessages,
  useListEngrams,
  useListHubActivity,
  useListHubPresence,
  useListHubSpaces,
  useListSimulations,
  useMarkEngramMessagesSeen,
  useReplyToEngramMessage,
} from "@workspace/api-client-react";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useOfflineMode } from "@/lib/offline/mode";
import { cacheHumanMessages } from "@/lib/offline/store";
import { getOperatorReplyDisplayState } from "@/lib/reply-acknowledgement";
import { queryClient } from "@/lib/query-client";
import { e2eAuthBypass, useE2EAuthUserId } from "@/lib/e2e-auth";
import { getAccountLiveStateQueryKey } from "@/lib/account-query-scope";

export default function HubScreen() {
  const { t, i18n } = useTranslation("mobile");
  const rtl = isRtlLanguage(i18n.resolvedLanguage ?? i18n.language);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const offline = useOfflineMode();
  const { isSignedIn, userId: clerkUserId } = useAuth();
  const e2eUserId = useE2EAuthUserId();
  const accountId = e2eAuthBypass
    ? e2eUserId
    : isSignedIn
      ? clerkUserId ?? null
      : null;
  const engrams = useListEngrams();
  const states = useGetEngramStates({
    query: {
      enabled: Boolean(accountId),
      queryKey: getAccountLiveStateQueryKey(accountId, offline),
    },
  });
  const spaces = useListHubSpaces();
  const presence = useListHubPresence();
  const activity = useListHubActivity({ limit: 12 });
  const simulations = useListSimulations();
  const controls = useGetHubControls();
  const humanMessages = useListEngramMessages({ channel: "human", limit: 100 });
  const isLoading =
    offline
      ? humanMessages.isLoading
      : engrams.isLoading ||
        states.isLoading ||
        spaces.isLoading ||
        presence.isLoading ||
        activity.isLoading ||
        humanMessages.isLoading;
  const isError =
    offline
      ? humanMessages.isError
      : engrams.isError ||
        states.isError ||
        spaces.isError ||
        presence.isError ||
        activity.isError ||
        humanMessages.isError;
  const refreshing =
    offline
      ? humanMessages.isRefetching
      : engrams.isRefetching ||
        states.isRefetching ||
        spaces.isRefetching ||
        presence.isRefetching ||
        activity.isRefetching ||
        simulations.isRefetching ||
        humanMessages.isRefetching;

  useEffect(() => {
    if (!offline && humanMessages.data) {
      void cacheHumanMessages(humanMessages.data).catch(() => {});
    }
  }, [humanMessages.data, offline]);

  const refresh = () => {
    if (offline) {
      void humanMessages.refetch();
      return;
    }
    void Promise.all([
      engrams.refetch(),
      states.refetch(),
      spaces.refetch(),
      presence.refetch(),
      activity.refetch(),
      simulations.refetch(),
      controls.refetch(),
      humanMessages.refetch(),
    ]);
  };

  const engramById = useMemo(
    () => new Map((engrams.data ?? []).map((item) => [item.id, item])),
    [engrams.data],
  );
  const spaceById = useMemo(
    () => new Map((spaces.data ?? []).map((item) => [item.id, item])),
    [spaces.data],
  );

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <EmptyState
          icon={<Feather name="activity" size={28} color={colors.mutedForeground} />}
          title={t("hub.connectionLost")}
          subtitle={t("hub.connectionLostSubtitle")}
        />
      </View>
    );
  }

  return (
    <FlatList
      data={activity.data ?? []}
      keyExtractor={(item) => `activity-${item.id}`}
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.content,
        { paddingTop: (insets.top || 0) + 18, paddingBottom: (insets.bottom || 0) + 110 },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refresh}
          tintColor={colors.primary}
        />
      }
      ListHeaderComponent={
        <View>
          <Text
            style={[
              styles.kicker,
              { color: colors.primary },
              rtl && styles.kickerRtl,
            ]}
          >
            {t("hub.kicker")}
          </Text>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {t("hub.title")}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {t("hub.subtitle")}
          </Text>

          <View
            style={[
              styles.telemetryCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.cardHeader}>
              <MonoLabel color={colors.primary} style={styles.cardLabel}>
                {t("hub.telemetry")}
              </MonoLabel>
              <MonoLabel color={colors.mutedForeground} style={styles.status}>
                {controls.data?.paused
                  ? t("hub.paused")
                  : controls.data?.quietMode
                    ? t("hub.quiet")
                    : t("hub.live")}
              </MonoLabel>
            </View>
            {(states.data ?? []).map((state) => {
              const engram = engramById.get(state.engramId);
              return (
                <View key={state.engramId} style={styles.telemetryRow}>
                  <View style={styles.rowMain}>
                    <Text style={[styles.symbol, { color: colors.primary }]}>
                      {engram?.symbol ?? "◇"}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                        {engram?.name ?? `#${state.engramId}`}
                      </Text>
                      <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>
                        {state.currentMood ?? t("hub.noMood")} ·{" "}
                        {state.ready ? t("hub.ready") : t("hub.waiting")}
                      </Text>
                    </View>
                    <Text style={[styles.charge, { color: colors.accent }]}>
                      {Math.round(state.topCharge * 100)}%
                    </Text>
                  </View>
                  <ScoreBar value={state.topCharge} color={colors.accent} />
                </View>
              );
            })}
          </View>

          <MonoLabel style={styles.sectionLabel}>
            {t("hub.spaces")}
          </MonoLabel>
          <View style={styles.spaceGrid}>
            {(spaces.data ?? []).map((space) => {
              const occupants = (presence.data ?? []).filter(
                (item) => item.spaceId === space.id,
              );
              return (
                <View
                  key={space.id}
                  style={[
                    styles.spaceCard,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <View style={styles.cardHeader}>
                    <Text style={[styles.spaceName, { color: colors.foreground }]}>
                      {space.name}
                    </Text>
                    <Feather name="map-pin" size={14} color={colors.primary} />
                  </View>
                  <Text style={[styles.spaceKind, { color: colors.primary }]}>
                    {space.kind.replaceAll("_", " ")}
                  </Text>
                  <Text
                    numberOfLines={2}
                    style={[styles.spaceDescription, { color: colors.mutedForeground }]}
                  >
                    {space.description}
                  </Text>
                  <MonoLabel color={colors.mutedForeground} style={styles.occupants}>
                    {occupants.length} {t("hub.occupants")}
                  </MonoLabel>
                </View>
              );
            })}
          </View>

          <MonoLabel style={styles.sectionLabel}>
            {t("hub.simulations")}
          </MonoLabel>
          <SimulationSection
            query={simulations}
            engrams={(engrams.data ?? []).map(({ id, name }) => ({ id, name }))}
            onRetry={() => void simulations.refetch()}
            onOpen={(id) => router.push(`/simulation/${id}`)}
          />
          <MonoLabel style={styles.sectionLabel}>
            {t(offline ? "hub.humanContactOffline" : "hub.humanContact")}
          </MonoLabel>
          <HumanContactSection
            messages={humanMessages.data ?? []}
            engramName={(id) => engramById.get(id)?.name}
          />
          <MonoLabel style={styles.sectionLabel}>
            {t("hub.activity")}
          </MonoLabel>
        </View>
      }
      renderItem={({ item }) => (
        <View style={[styles.activityRow, { borderBottomColor: colors.border }]}>
          <Feather name="radio" size={15} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.activityText, { color: colors.foreground }]}>
              {item.summary}
            </Text>
            <MonoLabel
              color={colors.mutedForeground}
              style={styles.activityMeta}
            >
              {spaceById.get(item.spaceId)?.name ?? t("hub.unknownSpace")} ·{" "}
              {item.engramId ? engramById.get(item.engramId)?.name ?? `#${item.engramId}` : t("hub.system")}
            </MonoLabel>
          </View>
        </View>
      )}
      ListEmptyComponent={
        <Text style={[styles.emptyActivity, { color: colors.mutedForeground }]}>
          {t("hub.noActivity")}
        </Text>
      }
    />
  );
}

function HumanContactSection({
  messages,
  engramName,
}: {
  messages: EngramMessage[];
  engramName: (id: number) => string | undefined;
}) {
  const { t, i18n } = useTranslation("mobile");
  const rtl = isRtlLanguage(i18n.resolvedLanguage ?? i18n.language);
  const colors = useColors();
  const [replyOpenId, setReplyOpenId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [replyErrorId, setReplyErrorId] = useState<number | null>(null);
  const [markSeenErrorId, setMarkSeenErrorId] = useState<number | null>(null);
  const reply = useReplyToEngramMessage();
  const markSeen = useMarkEngramMessagesSeen();
  const queryKey = getListEngramMessagesQueryKey({ channel: "human", limit: 100 });
  const incoming = messages;

  const sendReply = async (message: EngramMessage) => {
    const content = drafts[message.id]?.trim() ?? "";
    if (!content || reply.isPending) return;
    try {
      setReplyErrorId(null);
      await reply.mutateAsync({ id: message.id, data: { content } });
      setDrafts((current) => ({ ...current, [message.id]: "" }));
      setReplyOpenId(null);
      await queryClient.invalidateQueries({ queryKey });
    } catch {
      // The composer remains open so the operator can retry without losing text.
      setReplyErrorId(message.id);
    }
  };

  const markRead = async (message: EngramMessage) => {
    if (message.seen || message.id <= 0 || markSeen.isPending) return;
    try {
      setMarkSeenErrorId(null);
      await markSeen.mutateAsync({ data: { ids: [message.id] } });
      // Update only this row in place. Refetching the whole list can hide local
      // operator replies that are still waiting in the offline outbox.
      queryClient.setQueryData<EngramMessage[]>(queryKey, (current) =>
        current?.map((row) =>
          row.id === message.id ? { ...row, seen: true } : row,
        ),
      );
    } catch {
      setMarkSeenErrorId(message.id);
    }
  };

  if (incoming.length === 0) {
    return (
      <Text style={[styles.emptyActivity, { color: colors.mutedForeground }]}>
        {t("hub.noHumanContact")}
      </Text>
    );
  }

  return (
    <View style={styles.humanContactList}>
      {incoming.map((message) => {
        const isOpen = replyOpenId === message.id;
        const replyStatus = getOperatorReplyDisplayState(message);
        const acknowledgementLabelKey =
          replyStatus?.acknowledgement === "acknowledged"
            ? ("hub.acknowledgement.acknowledged" as const)
            : ("hub.acknowledgement.pending" as const);
        const acknowledgementLabel = replyStatus
          ? t(acknowledgementLabelKey)
          : "";
        return (
          <View
            key={message.id}
            style={[
              styles.humanContactCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.humanContactHeader}>
              <Feather name="message-circle" size={15} color={colors.primary} />
              <MonoLabel color={colors.foreground} style={styles.humanContactMeta}>
                {engramName(message.fromEngramId) ?? `#${message.fromEngramId}`}
              </MonoLabel>
              <MonoLabel color={colors.mutedForeground} style={styles.humanContactMeta}>
                {message.author === "operator"
                  ? t("hub.operatorMessage")
                  : message.isDigest
                    ? t("hub.humanDigest")
                    : t("hub.humanMessage")}
              </MonoLabel>
              <MonoLabel color={colors.mutedForeground} style={styles.humanContactMeta}>
                {message.id < 0
                  ? t("hub.replyQueued")
                  : message.seen
                    ? ""
                    : "•"}
              </MonoLabel>
            </View>
            <Text style={[styles.humanContactText, { color: colors.foreground }]}>
              {message.content}
            </Text>
            {replyStatus ? (
              <View
                accessible
                accessibilityRole="text"
                accessibilityLabel={`${t("hub.acknowledgement.saved")}, ${acknowledgementLabel}`}
                style={styles.replyAcknowledgementRow}
              >
                <Chip label={t("hub.acknowledgement.saved")} />
                <Chip
                  label={acknowledgementLabel}
                  tone={
                    replyStatus.acknowledgement === "acknowledged"
                      ? "success"
                      : "accent"
                  }
                />
              </View>
            ) : null}
            {message.author === "engram" &&
            message.id > 0 &&
            !message.seen ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("hub.markRead")}
                disabled={markSeen.isPending}
                onPress={() => void markRead(message)}
                style={({ pressed }) => [
                  styles.replyToggle,
                  { opacity: markSeen.isPending ? 0.45 : pressed ? 0.7 : 1 },
                ]}
              >
                <Feather name="check-circle" size={14} color={colors.primary} />
                <Text
                  style={[
                    styles.replyToggleText,
                    { color: colors.primary },
                    rtl && styles.replyToggleTextRtl,
                  ]}
                >
                  {t("hub.markRead")}
                </Text>
              </Pressable>
            ) : null}
            {markSeenErrorId === message.id ? (
              <Text style={[styles.markReadError, { color: colors.destructive }]}>
                {t("hub.markReadFailed")}
              </Text>
            ) : null}
            {message.author === "engram" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("hub.reply")}
                onPress={() => setReplyOpenId(isOpen ? null : message.id)}
                style={({ pressed }) => [
                  styles.replyToggle,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Feather name={isOpen ? "x" : "corner-up-left"} size={14} color={colors.primary} />
                <Text
                  style={[
                    styles.replyToggleText,
                    { color: colors.primary },
                    rtl && styles.replyToggleTextRtl,
                  ]}
                >
                  {isOpen ? t("common.cancel") : t("hub.reply")}
                </Text>
              </Pressable>
            ) : null}
            {isOpen && message.author === "engram" ? (
              <KeyboardAvoidingView behavior="padding" style={styles.replyComposer}>
                <TextInput
                  autoFocus
                  maxLength={2000}
                  multiline
                  onChangeText={(value) =>
                    setDrafts((current) => ({ ...current, [message.id]: value }))
                  }
                  onSubmitEditing={() => void sendReply(message)}
                  placeholder={t("hub.replyPlaceholder")}
                  placeholderTextColor={colors.mutedForeground}
                  returnKeyType="send"
                  style={[
                    styles.replyInput,
                    { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground },
                    rtl && styles.replyInputRtl,
                  ]}
                  value={drafts[message.id] ?? ""}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={reply.isPending || !(drafts[message.id] ?? "").trim()}
                  onPress={() => void sendReply(message)}
                  style={({ pressed }) => [
                    styles.replyButton,
                    {
                      backgroundColor: colors.primary,
                      opacity:
                        reply.isPending || !(drafts[message.id] ?? "").trim()
                          ? 0.45
                          : pressed
                            ? 0.75
                            : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.replyButtonText,
                      rtl && styles.replyToggleTextRtl,
                    ]}
                  >
                    {reply.isPending ? t("hub.replySending") : t("hub.reply")}
                  </Text>
                </Pressable>
                {replyErrorId === message.id ? (
                  <Text style={[styles.replyError, { color: colors.destructive }]}>
                    {t("hub.replyFailed")}
                  </Text>
                ) : null}
              </KeyboardAvoidingView>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 20 },
  kicker: {
    fontFamily: "JetBrainsMono_500Medium",
    fontSize: 11,
    letterSpacing: 2,
  },
  kickerRtl: { writingDirection: "ltr", textAlign: "right" },
  title: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 34,
    marginTop: 4,
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 2,
    marginBottom: 20,
  },
  telemetryCard: { borderWidth: 1, borderRadius: 8, padding: 16 },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  cardLabel: { flexShrink: 1 },
  status: { fontSize: 10, flexShrink: 1 },
  telemetryRow: { gap: 8, marginTop: 17 },
  rowMain: { flexDirection: "row", alignItems: "center", gap: 10 },
  symbol: { fontFamily: "Rajdhani_700Bold", fontSize: 24, width: 28 },
  rowTitle: { fontFamily: "Rajdhani_600SemiBold", fontSize: 17 },
  rowMeta: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 2 },
  charge: { fontFamily: "JetBrainsMono_500Medium", fontSize: 12 },
  sectionLabel: { fontSize: 10, marginTop: 26, marginBottom: 10 },
  simulationSection: { gap: 10 },
  simulationStateCard: {
    minHeight: 76,
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    justifyContent: "center",
  },
  simulationStateRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  simulationStateText: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18, flex: 1 },
  simulationFilters: { gap: 12, marginBottom: 2 },
  simulationFilterHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  simulationFilterGroup: { gap: 6 },
  simulationFilterLabel: { fontSize: 9, letterSpacing: 0.7 },
  simulationFilterOptions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingRight: 16,
  },
  simulationFilterOptionsRtl: { flexDirection: "row-reverse" },
  simulationFilterChip: {
    minHeight: 32,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  simulationFilterChipText: { fontFamily: "Inter_500Medium", fontSize: 11 },
  simulationClearFilters: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 13,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  simulationClearFiltersRtl: {
    fontFamily: "Inter_500Medium",
    letterSpacing: 0,
    textTransform: "none",
    writingDirection: "rtl",
  },
  simulationNoMatches: {
    minHeight: 58,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    justifyContent: "center",
  },
  simulationCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    gap: 10,
  },
  simulationCardHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  simulationLabel: { fontSize: 10, flexShrink: 1 },
  simulationPremise: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 19,
  },
  simulationProgress: { fontSize: 10, flexShrink: 1 },
  simulationAction: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 14,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    flexShrink: 1,
  },
  simulationActionRtl: {
    fontFamily: undefined,
    letterSpacing: 0,
    textTransform: "none",
    writingDirection: "rtl",
  },
  spaceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  spaceCard: { borderWidth: 1, borderRadius: 8, padding: 12, width: "48%" },
  spaceName: { fontFamily: "Rajdhani_600SemiBold", fontSize: 16, flex: 1 },
  spaceKind: { fontFamily: "JetBrainsMono_400Regular", fontSize: 9, marginTop: 5, textTransform: "uppercase" },
  spaceDescription: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16, marginTop: 9 },
  occupants: { fontSize: 10, marginTop: 12 },
  activityRow: { flexDirection: "row", gap: 10, paddingVertical: 12, borderBottomWidth: 1 },
  activityText: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 18 },
  activityMeta: { fontSize: 9, marginTop: 4, flexShrink: 1 },
  emptyActivity: { fontFamily: "Inter_400Regular", fontSize: 13, paddingVertical: 18 },
  humanContactList: { gap: 10 },
  humanContactCard: { borderWidth: 1, borderRadius: 8, padding: 14, gap: 10 },
  humanContactHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  humanContactMeta: { fontSize: 10, flex: 1, flexShrink: 1 },
  humanContactText: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21 },
  replyAcknowledgementRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  replyToggle: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  replyToggleText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 13,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  replyToggleTextRtl: {
    fontFamily: undefined,
    letterSpacing: 0,
    textTransform: "none",
    writingDirection: "rtl",
  },
  replyComposer: { gap: 8 },
  replyInput: {
    borderWidth: 1,
    borderRadius: 7,
    minHeight: 42,
    maxHeight: 110,
    paddingHorizontal: 11,
    paddingVertical: 9,
    fontFamily: "Inter_400Regular",
    fontSize: 13,
  },
  replyInputRtl: { writingDirection: "rtl", textAlign: "right" },
  replyButton: { borderRadius: 7, paddingVertical: 10, alignItems: "center" },
  replyButtonText: {
    color: "#FFFFFF",
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 14,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  replyError: { fontFamily: "Inter_400Regular", fontSize: 12 },
  markReadError: { fontFamily: "Inter_400Regular", fontSize: 12 },
});

type SimulationQuery = UseQueryResult<Simulation[]>;
type SimulationEngramOption = { id: number; name: string };
type SimulationStatusFilter = "all" | Simulation["status"];

const SIMULATION_STATUS_FILTERS: SimulationStatusFilter[] = [
  "all",
  "proposed",
  "running",
  "paused",
  "ended",
];

function SimulationSection({
  query,
  engrams,
  onRetry,
  onOpen,
}: {
  query: SimulationQuery;
  engrams: SimulationEngramOption[];
  onRetry: () => void;
  onOpen: (id: number) => void;
}) {
  const { t, i18n } = useTranslation("mobile");
  const rtl = isRtlLanguage(i18n.resolvedLanguage ?? i18n.language);
  const colors = useColors();
  const [statusFilter, setStatusFilter] = useState<SimulationStatusFilter>("all");
  const [engramFilterId, setEngramFilterId] = useState<number | null>(null);

  const hasActiveFilters = statusFilter !== "all" || engramFilterId !== null;
  const selectedEngram = engrams.find((engram) => engram.id === engramFilterId);
  const hasEngramFilter = engramFilterId !== null;
  const selectedEngramName =
    selectedEngram?.name ??
    (hasEngramFilter ? t("hub.simulationUnknownEngram") : "");
  const filteredSimulations = useMemo(
    () =>
      (query.data ?? []).filter((simulation) => {
        const matchesStatus =
          statusFilter === "all" || simulation.status === statusFilter;
        const participantIds =
          simulation.participantEngramIds?.length > 0
            ? simulation.participantEngramIds
            : [simulation.engramId];
        const matchesEngram =
          engramFilterId === null || participantIds.includes(engramFilterId);
        return matchesStatus && matchesEngram;
      }),
    [engramFilterId, query.data, statusFilter],
  );

  if (query.isLoading) {
    return (
      <View style={[styles.simulationStateCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <View style={styles.simulationStateRow}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.simulationStateText, { color: colors.mutedForeground }]}>
            {t("hub.simulationsLoading")}
          </Text>
        </View>
      </View>
    );
  }

  if (query.isError) {
    return (
      <View style={[styles.simulationStateCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Text style={[styles.simulationStateText, { color: colors.mutedForeground }]}>
          {t("hub.simulationsError")}
        </Text>
        <Pressable onPress={onRetry} hitSlop={8}>
          <Text
            style={[
              styles.simulationAction,
              { color: colors.primary },
              rtl && styles.simulationActionRtl,
            ]}
          >
            {t("hub.simulationsRetry")}
          </Text>
        </Pressable>
      </View>
    );
  }

  if (!query.data?.length) {
    return (
      <Text style={[styles.emptyActivity, { color: colors.mutedForeground }]}>
        {t("hub.noSimulations")}
      </Text>
    );
  }

  return (
    <View style={styles.simulationSection}>
      <View style={styles.simulationFilters}>
        <View style={styles.simulationFilterHeader}>
          <MonoLabel color={colors.mutedForeground} style={styles.simulationFilterLabel}>
            {t("hub.simulationFilters")}
          </MonoLabel>
          {hasActiveFilters ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setStatusFilter("all");
                setEngramFilterId(null);
              }}
              testID="hub-simulation-filters-clear"
              hitSlop={8}
            >
              <Text
                style={[
                  styles.simulationClearFilters,
                  { color: colors.primary },
                  rtl && styles.simulationClearFiltersRtl,
                ]}
              >
                {t("hub.simulationClearFilters")}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.simulationFilterGroup}>
          <MonoLabel color={colors.mutedForeground} style={styles.simulationFilterLabel}>
            {t("hub.simulationStatusFilter")}
          </MonoLabel>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[
              styles.simulationFilterOptions,
              rtl && styles.simulationFilterOptionsRtl,
            ]}
          >
            {SIMULATION_STATUS_FILTERS.map((status) => {
              const selected = statusFilter === status;
              const label =
                status === "all"
                  ? t("hub.simulationFilterAll")
                  : t(`hub.simulationStatus.${status}`);
              return (
                <Pressable
                  key={status}
                  accessibilityRole="button"
                  accessibilityLabel={t("hub.simulationStatusFilterChoice", {
                    status: label,
                  })}
                  accessibilityState={{ selected }}
                  onPress={() => setStatusFilter(status)}
                  testID={`hub-simulation-status-${status}`}
                  style={[
                    styles.simulationFilterChip,
                    {
                      backgroundColor: selected ? colors.primary : colors.card,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.simulationFilterChipText,
                      { color: selected ? colors.primaryForeground : colors.mutedForeground },
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.simulationFilterGroup}>
          <MonoLabel color={colors.mutedForeground} style={styles.simulationFilterLabel}>
            {t("hub.simulationEngramFilter")}
          </MonoLabel>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[
              styles.simulationFilterOptions,
              rtl && styles.simulationFilterOptionsRtl,
            ]}
          >
            {[
              { id: null, name: t("hub.simulationAllEngrams") },
              ...engrams.map(({ id, name }) => ({ id, name })),
            ].map((engram) => {
              const selected = engramFilterId === engram.id;
              const testId =
                engram.id === null
                  ? "hub-simulation-engram-all"
                  : `hub-simulation-engram-${engram.id}`;
              return (
                <Pressable
                  key={testId}
                  accessibilityRole="button"
                  accessibilityLabel={t("hub.simulationEngramFilterChoice", {
                    engram: engram.name,
                  })}
                  accessibilityState={{ selected }}
                  onPress={() => setEngramFilterId(engram.id)}
                  testID={testId}
                  style={[
                    styles.simulationFilterChip,
                    {
                      backgroundColor: selected ? colors.primary : colors.card,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.simulationFilterChipText,
                      { color: selected ? colors.primaryForeground : colors.mutedForeground },
                    ]}
                  >
                    {engram.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>

      {filteredSimulations.length === 0 ? (
        <View
          style={[
            styles.simulationNoMatches,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.simulationStateText, { color: colors.mutedForeground }]}>
            {statusFilter !== "all" && hasEngramFilter
              ? t("hub.simulationNoCombinedMatches", {
                  status: t(`hub.simulationStatus.${statusFilter}`),
                  engram: selectedEngramName,
                })
              : statusFilter !== "all"
                ? t("hub.simulationNoStatusMatches", {
                    status: t(`hub.simulationStatus.${statusFilter}`),
                  })
                : hasEngramFilter
                  ? t("hub.simulationNoEngramMatches", {
                      engram: selectedEngramName,
                    })
                  : t("hub.noSimulations")}
          </Text>
        </View>
      ) : (
        filteredSimulations.map((simulation) => {
          const progress = simulation.maxSteps
            ? simulation.currentStep / simulation.maxSteps
            : 0;
          return (
            <Pressable
              key={simulation.id}
              onPress={() => onOpen(simulation.id)}
              style={({ pressed }) => [
                styles.simulationCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  opacity: pressed ? 0.78 : 1,
                },
              ]}
            >
              <View style={styles.simulationCardHeader}>
                <MonoLabel color={colors.primary} style={styles.simulationLabel}>
                  {t("hub.simulationRun", { id: simulation.id })}
                </MonoLabel>
                <Chip
                  label={t(`hub.simulationStatus.${simulation.status}`)}
                  tone={simulation.status === "ended" ? "muted" : "accent"}
                />
              </View>
              <Text
                numberOfLines={2}
                style={[styles.simulationPremise, { color: colors.foreground }]}
              >
                {simulation.premise}
              </Text>
              <View style={styles.simulationCardHeader}>
                <MonoLabel
                  color={colors.mutedForeground}
                  style={styles.simulationProgress}
                >
                  {t("hub.simulationProgress", {
                    current: simulation.currentStep,
                    max: simulation.maxSteps,
                  })}
                </MonoLabel>
                <Text
                  style={[
                    styles.simulationAction,
                    { color: colors.primary },
                    rtl && styles.simulationActionRtl,
                  ]}
                >
                  {t("hub.reviewSimulation")}
                </Text>
              </View>
              <ScoreBar value={progress} color={colors.violet} />
            </Pressable>
          );
        })
      )}
    </View>
  );
}