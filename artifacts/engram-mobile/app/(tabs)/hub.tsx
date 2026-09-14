import { Feather } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import type { UseQueryResult } from "@tanstack/react-query";

import { Chip, EmptyState, ScoreBar } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
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
  useReplyToEngramMessage,
} from "@workspace/api-client-react";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useOfflineMode } from "@/lib/offline/mode";
import { cacheHumanMessages } from "@/lib/offline/store";
import { queryClient } from "@/lib/query-client";

export default function HubScreen() {
  const { t } = useTranslation("mobile");
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const offline = useOfflineMode();
  const engrams = useListEngrams();
  const states = useGetEngramStates();
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
          <Text style={[styles.kicker, { color: colors.primary }]}>
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
              <Text style={[styles.cardLabel, { color: colors.primary }]}>
                {t("hub.telemetry")}
              </Text>
              <Text style={[styles.status, { color: colors.mutedForeground }]}>
                {controls.data?.paused
                  ? t("hub.paused")
                  : controls.data?.quietMode
                    ? t("hub.quiet")
                    : t("hub.live")}
              </Text>
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

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            {t("hub.spaces")}
          </Text>
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
                  <Text style={[styles.occupants, { color: colors.mutedForeground }]}>
                    {occupants.length} {t("hub.occupants")}
                  </Text>
                </View>
              );
            })}
          </View>

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            {t("hub.simulations")}
          </Text>
          <SimulationSection
            query={simulations}
            onRetry={() => void simulations.refetch()}
            onOpen={(id) => router.push(`/simulation/${id}`)}
          />
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            {t(offline ? "hub.humanContactOffline" : "hub.humanContact")}
          </Text>
          <HumanContactSection
            messages={humanMessages.data ?? []}
            engramName={(id) => engramById.get(id)?.name}
          />
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            {t("hub.activity")}
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={[styles.activityRow, { borderBottomColor: colors.border }]}>
          <Feather name="radio" size={15} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.activityText, { color: colors.foreground }]}>
              {item.summary}
            </Text>
            <Text style={[styles.activityMeta, { color: colors.mutedForeground }]}>
              {spaceById.get(item.spaceId)?.name ?? t("hub.unknownSpace")} ·{" "}
              {item.engramId ? engramById.get(item.engramId)?.name ?? `#${item.engramId}` : t("hub.system")}
            </Text>
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
  const { t } = useTranslation("mobile");
  const colors = useColors();
  const [replyOpenId, setReplyOpenId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [replyErrorId, setReplyErrorId] = useState<number | null>(null);
  const reply = useReplyToEngramMessage();
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
              <Text style={[styles.humanContactMeta, { color: colors.foreground }]}>
                {engramName(message.fromEngramId) ?? `#${message.fromEngramId}`}
              </Text>
              <Text style={[styles.humanContactMeta, { color: colors.mutedForeground }]}>
                {message.author === "operator"
                  ? t("hub.operatorMessage")
                  : message.isDigest
                    ? t("hub.humanDigest")
                    : t("hub.humanMessage")}
              </Text>
              <Text style={[styles.humanContactMeta, { color: colors.mutedForeground }]}>
                {message.id < 0
                  ? t("hub.replyQueued")
                  : message.seen
                    ? ""
                    : "•"}
              </Text>
            </View>
            <Text style={[styles.humanContactText, { color: colors.foreground }]}>
              {message.content}
            </Text>
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
                <Text style={[styles.replyToggleText, { color: colors.primary }]}>
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
                  <Text style={styles.replyButtonText}>
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
  },
  cardLabel: {
    fontFamily: "JetBrainsMono_500Medium",
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  status: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 10,
    textTransform: "uppercase",
  },
  telemetryRow: { gap: 8, marginTop: 17 },
  rowMain: { flexDirection: "row", alignItems: "center", gap: 10 },
  symbol: { fontFamily: "Rajdhani_700Bold", fontSize: 24, width: 28 },
  rowTitle: { fontFamily: "Rajdhani_600SemiBold", fontSize: 17 },
  rowMeta: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 2 },
  charge: { fontFamily: "JetBrainsMono_500Medium", fontSize: 12 },
  sectionLabel: {
    fontFamily: "JetBrainsMono_500Medium",
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginTop: 26,
    marginBottom: 10,
  },
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
  simulationCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    gap: 10,
  },
  simulationCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  simulationLabel: {
    fontFamily: "JetBrainsMono_500Medium",
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  simulationPremise: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 19,
  },
  simulationProgress: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 10,
  },
  simulationAction: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 14,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  spaceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  spaceCard: { borderWidth: 1, borderRadius: 8, padding: 12, width: "48.8%" },
  spaceName: { fontFamily: "Rajdhani_600SemiBold", fontSize: 16, flex: 1 },
  spaceKind: { fontFamily: "JetBrainsMono_400Regular", fontSize: 9, marginTop: 5, textTransform: "uppercase" },
  spaceDescription: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16, marginTop: 9 },
  occupants: { fontFamily: "JetBrainsMono_400Regular", fontSize: 10, marginTop: 12 },
  activityRow: { flexDirection: "row", gap: 10, paddingVertical: 12, borderBottomWidth: 1 },
  activityText: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 18 },
  activityMeta: { fontFamily: "JetBrainsMono_400Regular", fontSize: 9, marginTop: 4 },
  emptyActivity: { fontFamily: "Inter_400Regular", fontSize: 13, paddingVertical: 18 },
  humanContactList: { gap: 10 },
  humanContactCard: { borderWidth: 1, borderRadius: 8, padding: 14, gap: 10 },
  humanContactHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  humanContactMeta: { fontFamily: "JetBrainsMono_400Regular", fontSize: 10, flex: 1 },
  humanContactText: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21 },
  replyToggle: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  replyToggleText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 13,
    letterSpacing: 0.6,
    textTransform: "uppercase",
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
  replyButton: { borderRadius: 7, paddingVertical: 10, alignItems: "center" },
  replyButtonText: {
    color: "#FFFFFF",
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 14,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  replyError: { fontFamily: "Inter_400Regular", fontSize: 12 },
});

type SimulationQuery = UseQueryResult<Simulation[]>;

function SimulationSection({
  query,
  onRetry,
  onOpen,
}: {
  query: SimulationQuery;
  onRetry: () => void;
  onOpen: (id: number) => void;
}) {
  const { t } = useTranslation("mobile");
  const colors = useColors();

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
          <Text style={[styles.simulationAction, { color: colors.primary }]}>
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
      {query.data.map((simulation) => {
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
              <Text style={[styles.simulationLabel, { color: colors.primary }]}>
                {t("hub.simulationRun", { id: simulation.id })}
              </Text>
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
              <Text style={[styles.simulationProgress, { color: colors.mutedForeground }]}>
                {t("hub.simulationProgress", {
                  current: simulation.currentStep,
                  max: simulation.maxSteps,
                })}
              </Text>
              <Text style={[styles.simulationAction, { color: colors.primary }]}>
                {t("hub.reviewSimulation")}
              </Text>
            </View>
            <ScoreBar value={progress} color={colors.violet} />
          </Pressable>
        );
      })}
    </View>
  );
}