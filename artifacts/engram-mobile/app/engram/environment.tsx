import { Feather } from "@expo/vector-icons";
import { Stack, useLocalSearchParams } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Chip, EmptyState, MonoLabel, ScoreBar } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useOfflineMode } from "@/lib/offline/mode";
import {
  getGetEngramQueryKey,
  getGetEngramStatesQueryKey,
  useGetEngram,
  useGetEngramStates,
} from "@workspace/api-client-react";

export default function EnvironmentScreen() {
  const { t } = useTranslation("mobile");
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
    },
  });
  const live = states.data?.find((item) => item.engramId === id);

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
        <Text style={[styles.kicker, { color: colors.primary }]}>
          {t("environment.kicker")} // {item.symbol}
        </Text>
        <Text style={[styles.title, { color: colors.foreground }]}>{item.name}</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {t("environment.subtitle")}
        </Text>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <MonoLabel color={colors.primary}>{t("environment.liveState")}</MonoLabel>
          <View style={styles.liveLine}>
            <Chip
              label={live?.autonomyEnabled ? t("environment.autonomyOn") : t("environment.autonomyOff")}
              tone={live?.autonomyEnabled ? "success" : "muted"}
            />
            <Text style={[styles.mood, { color: colors.foreground }]}>
              {live?.currentMood ?? item.currentMood ?? item.emotionalBaseline.mood}
            </Text>
          </View>
          <View style={styles.metrics}>
            <Metric label={t("environment.topCharge")} value={live?.topCharge ?? 0} colors={colors} />
            <Metric label={t("environment.threshold")} value={live?.initiationThreshold ?? item.initiationThreshold} max={1} colors={colors} />
          </View>
          <Text style={[styles.status, { color: colors.mutedForeground }]}>
            {live?.inCooldown
              ? t("environment.cooldown")
              : live?.inBackoff
                ? t("environment.backoff")
                : live?.ready
                  ? t("environment.ready")
                  : t("environment.waiting")}
          </Text>
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
          {(live?.drives ?? item.drives.map((drive) => ({
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
      <Text style={[styles.meta, { color: colors.mutedForeground }]}>{label}</Text>
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
  title: { fontFamily: "Rajdhani_700Bold", fontSize: 34, marginTop: 4 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19, marginTop: 3, marginBottom: 22 },
  card: { borderWidth: 1, borderRadius: 8, padding: 16 },
  liveLine: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 14 },
  mood: { fontFamily: "Rajdhani_600SemiBold", fontSize: 18 },
  metrics: { flexDirection: "row", gap: 12, marginTop: 20 },
  metric: { flex: 1, gap: 7 },
  metricValue: { fontFamily: "JetBrainsMono_500Medium", fontSize: 17 },
  status: { fontFamily: "JetBrainsMono_400Regular", fontSize: 10, marginTop: 16, textTransform: "uppercase" },
  sectionLabel: { marginTop: 26, marginBottom: 10 },
  anchorName: { fontFamily: "Rajdhani_600SemiBold", fontSize: 20, marginBottom: 8 },
  body: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21 },
  meta: { fontFamily: "JetBrainsMono_400Regular", fontSize: 10, textTransform: "uppercase" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 14 },
  drive: { gap: 7, marginBottom: 16 },
  driveHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  driveName: { fontFamily: "Rajdhani_600SemiBold", fontSize: 16 },
});