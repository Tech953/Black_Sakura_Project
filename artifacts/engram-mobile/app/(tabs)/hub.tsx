import { Feather } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState, ScoreBar } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import {
  useGetEngramStates,
  useGetHubControls,
  useListEngrams,
  useListHubActivity,
  useListHubPresence,
  useListHubSpaces,
} from "@workspace/api-client-react";

export default function HubScreen() {
  const { t } = useTranslation("mobile");
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const engrams = useListEngrams();
  const states = useGetEngramStates();
  const spaces = useListHubSpaces();
  const presence = useListHubPresence();
  const activity = useListHubActivity({ limit: 12 });
  const controls = useGetHubControls();
  const isLoading =
    engrams.isLoading ||
    states.isLoading ||
    spaces.isLoading ||
    presence.isLoading ||
    activity.isLoading;
  const isError =
    engrams.isError ||
    states.isError ||
    spaces.isError ||
    presence.isError ||
    activity.isError;
  const refreshing =
    engrams.isRefetching ||
    states.isRefetching ||
    spaces.isRefetching ||
    presence.isRefetching ||
    activity.isRefetching;

  const refresh = () => {
    void Promise.all([
      engrams.refetch(),
      states.refetch(),
      spaces.refetch(),
      presence.refetch(),
      activity.refetch(),
      controls.refetch(),
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
});