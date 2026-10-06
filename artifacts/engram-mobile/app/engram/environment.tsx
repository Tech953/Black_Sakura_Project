import { Feather } from "@expo/vector-icons";
import { Stack, useLocalSearchParams } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Chip, EmptyState, MonoLabel, ScoreBar } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { isRtlLanguage } from "@/lib/layout-direction";
import { useOfflineMode } from "@/lib/offline/mode";
import {
  getGetEngramQueryKey,
  getGetEngramStatesQueryKey,
  useGetEngram,
  useGetEngramStates,
} from "@workspace/api-client-react";

export default function EnvironmentScreen() {
  const { t, i18n } = useTranslation("mobile");
  const rtl = isRtlLanguage(i18n.resolvedLanguage ?? i18n.language);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = Number(rawId);
  const offlineActive = useOfflineMode();
  const modeScope = offlineActive ? "offline-selection" : "online-selection";
  const engram = useGetEngram(id, {
    query: {
      enabled: Number.isFinite(id),
      queryKey: [...getGetEngramQueryKey(id), modeScope],
    },
  });
  const states = useGetEngramStates({
    query: {
      queryKey: [...getGetEngramStatesQueryKey(), modeScope],
      retry: false,
    },
  });
  const live = states.data?.find((item) => item.engramId === id);
  const liveAvailable = !states.isError && Boolean(live);
  const currentLive = liveAvailable ? live : undefined;

  if (engram.isLoading || states.isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (engram.isError || !engram.data) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <EmptyState
          icon={<Feather name="sliders" size={28} color={colors.mutedForeground} />}
          title={t("environment.unavailable")}
          subtitle={t("environment.unavailableSubtitle")}
        />
      </View>
    );
  }

  const item = engram.data;
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t("environment.title"),
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.primary,
          headerTitleStyle: { fontFamily: "Rajdhani_700Bold", color: colors.foreground },
        }}
      />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: (insets.bottom || 0) + 34 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text
          style={[
            styles.kicker,
            { color: colors.primary },
            rtl && styles.kickerRtl,
          ]}
        >
          {t("environment.kicker")} // {item.symbol}
        </Text>
        <Text style={[styles.title, { color: colors.foreground }]}>{item.name}</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {t("environment.subtitle")}
        </Text>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.liveHeader}>
            <MonoLabel color={colors.primary}>{t("environment.liveState")}</MonoLabel>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(
                liveAvailable
                  ? "environment.refreshLiveState"
                  : "environment.retryLiveState",
              )}
              disabled={states.isFetching}
              onPress={() => void states.refetch()}
              style={({ pressed }) => [
                styles.refreshAction,
                pressed && styles.refreshActionPressed,
                states.isFetching && styles.refreshActionDisabled,
              ]}
            >
              {states.isFetching ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Feather name="refresh-cw" size={13} color={colors.primary} />
              )}
              <Text style={[styles.refreshActionText, { color: colors.primary }]}>
                {t(
                  liveAvailable
                    ? "environment.refreshLiveState"
                    : "environment.retryLiveState",
                )}
              </Text>
            </Pressable>
          </View>
          {!currentLive ? (
            <View
              accessibilityRole="alert"
              style={[
                styles.unavailableNotice,
                { borderColor: colors.destructive + "66" },
              ]}
            >
              <Feather
                name="alert-circle"
                size={16}
                color={colors.destructive}
              />
              <View style={styles.unavailableCopy}>
                <Text
                  style={[
                    styles.unavailableTitle,
                    { color: colors.destructive },
                  ]}
                >
                  {t("environment.liveUnavailable")}
                </Text>
                <Text
                  style={[
                    styles.unavailableSubtitle,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {t("environment.showingSavedDriveValues")}
                </Text>
              </View>
            </View>
          ) : (
            <>
              <View style={styles.liveLine}>
                <Chip
                  label={
                    currentLive?.autonomyEnabled
                      ? t("environment.autonomyOn")
                      : t("environment.autonomyOff")
                  }
                  tone={currentLive?.autonomyEnabled ? "success" : "muted"}
                />
                <Text style={[styles.mood, { color: colors.foreground }]}>
                  {currentLive?.currentMood ??
                    item.currentMood ??
                    item.emotionalBaseline.mood}
                </Text>
              </View>
              <View style={styles.metrics}>
                <Metric
                  label={t("environment.topCharge")}
                  value={currentLive.topCharge}
                  colors={colors}
                />
                <Metric
                  label={t("environment.threshold")}
                  value={currentLive.initiationThreshold}
                  max={1}
                  colors={colors}
                />
              </View>
              <MonoLabel color={colors.mutedForeground} style={styles.status}>
                {currentLive?.inCooldown
                  ? t("environment.cooldown")
                  : currentLive?.inBackoff
                    ? t("environment.backoff")
                    : currentLive?.ready
                      ? t("environment.ready")
                      : t("environment.waiting")}
              </MonoLabel>
            </>
          )}
        </View>

        <MonoLabel style={styles.sectionLabel}>{t("environment.anchor")}</MonoLabel>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.anchorName, { color: colors.foreground }]}>
            {item.environmentAnchor.name}
          </Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            {item.environmentAnchor.description}
          </Text>
          <Text style={[styles.meta, { color: colors.primary }]}>
            {item.environmentAnchor.ambient}
          </Text>
          <View style={styles.chips}>
            {item.environmentAnchor.locations.map((location) => (
              <Chip key={location} label={location} tone="violet" />
            ))}
            {item.environmentAnchor.items.map((entry) => (
              <Chip key={entry} label={entry} tone="muted" />
            ))}
          </View>
        </View>

        <MonoLabel style={styles.sectionLabel}>{t("environment.drives")}</MonoLabel>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {(currentLive?.drives ?? item.drives.map((drive) => ({
            id: drive.id,
            label: drive.label,
            pressure: item.driveState?.[drive.id] ?? 0,
            weight: drive.weight,
            charge: (item.driveState?.[drive.id] ?? 0) * drive.weight,
          }))).map((drive) => (
            <View key={drive.id} style={styles.drive}>
              <View style={styles.driveHead}>
                <Text style={[styles.driveName, { color: colors.foreground }]}>{drive.label}</Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  {Math.round(drive.pressure * 100)}%
                </Text>
              </View>
              <ScoreBar value={drive.pressure} color={drive.pressure > 0.8 ? colors.accent : colors.primary} />
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function Metric({
  label,
  value,
  max = 1,
  colors,
}: {
  label: string;
  value: number;
  max?: number;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.metric}>
      <MonoLabel color={colors.mutedForeground} style={styles.metricLabel}>
        {label}
      </MonoLabel>
      <Text style={[styles.metricValue, { color: colors.foreground }]}>
        {value.toFixed(2)}
      </Text>
      <ScoreBar value={value / Math.max(max, 0.0001)} color={colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 20 },
  kicker: { fontFamily: "JetBrainsMono_500Medium", fontSize: 11, letterSpacing: 2 },
  kickerRtl: { writingDirection: "ltr", textAlign: "right" },
  title: { fontFamily: "Rajdhani_700Bold", fontSize: 34, marginTop: 4 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19, marginTop: 3, marginBottom: 22 },
  card: { borderWidth: 1, borderRadius: 8, padding: 16 },
  liveLine: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, marginTop: 14 },
  liveHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  refreshAction: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 6 },
  refreshActionPressed: { opacity: 0.65 },
  refreshActionDisabled: { opacity: 0.6 },
  refreshActionText: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  unavailableNotice: { flexDirection: "row", alignItems: "flex-start", gap: 9, borderWidth: 1, padding: 10, marginTop: 14 },
  unavailableCopy: { flex: 1, gap: 3 },
  unavailableTitle: { fontFamily: "JetBrainsMono_500Medium", fontSize: 11 },
  unavailableSubtitle: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 17 },
  mood: { fontFamily: "Rajdhani_600SemiBold", fontSize: 18, flex: 1, flexShrink: 1 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 20 },
  metric: { flex: 1, minWidth: 100, gap: 7 },
  metricLabel: { fontSize: 10 },
  metricValue: { fontFamily: "JetBrainsMono_500Medium", fontSize: 17 },
  status: { fontSize: 10, marginTop: 16, flexShrink: 1 },
  sectionLabel: { marginTop: 26, marginBottom: 10 },
  anchorName: { fontFamily: "Rajdhani_600SemiBold", fontSize: 20, marginBottom: 8 },
  body: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21 },
  meta: { fontFamily: "JetBrainsMono_400Regular", fontSize: 10, textTransform: "uppercase" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 14 },
  drive: { gap: 7, marginBottom: 16 },
  driveHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  driveName: { fontFamily: "Rajdhani_600SemiBold", fontSize: 16 },
});