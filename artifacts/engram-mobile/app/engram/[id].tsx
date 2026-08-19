import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Glyph } from "@/components/glyph";
import { Chip, MonoLabel, PrimaryButton, ScoreBar } from "@/components/ui";
import { useEngram } from "@/context/engram-context";
import { useColors } from "@/hooks/useColors";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetEngramQueryKey,
  getListEngramsQueryKey,
  useActivateEngram,
  useGetEngram,
} from "@workspace/api-client-react";

export default function EngramDetailScreen() {
  const { t } = useTranslation("mobile");
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Number(params.id);
  const { selectedEngramId, setSelectedEngramId } = useEngram();

  const { data: engram, isLoading } = useGetEngram(id, {
    query: { enabled: !Number.isNaN(id), queryKey: getGetEngramQueryKey(id) },
  });
  const activate = useActivateEngram();

  const isActive = selectedEngramId === id;

  const onActivate = useCallback(async () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    setSelectedEngramId(id);
    try {
      await activate.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListEngramsQueryKey() });
    } catch {
      // local selection persists
    }
    router.back();
  }, [activate, id, queryClient, router, setSelectedEngramId]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: engram?.name ?? t("detail.fallbackTitle"),
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.primary,
          headerTitleStyle: {
            fontFamily: "Rajdhani_700Bold",
            color: colors.foreground,
          },
        }}
      />
      {isLoading || !engram ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: (Platform.OS === "web" ? 34 : insets.bottom) + 120 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <Glyph symbol={engram.symbol} size={72} active={isActive} />
            <View style={styles.heroBody}>
              <Text style={[styles.name, { color: colors.foreground }]}>
                {engram.name}
              </Text>
              <Text style={[styles.title, { color: colors.mutedForeground }]}>
                {engram.title}
              </Text>
              <View style={styles.heroChips}>
                <Chip
                  label={engram.currentMood || engram.emotionalBaseline.mood}
                  tone="primary"
                />
                {engram.autonomyEnabled ? (
                  <Chip label={t("detail.autonomous")} tone="success" />
                ) : (
                  <Chip label={t("detail.dormant")} tone="muted" />
                )}
              </View>
            </View>
          </View>

          <Section label={t("detail.origin")} colors={colors}>
            <Text style={[styles.body, { color: colors.foreground }]}>
              {engram.origin}
            </Text>
          </Section>

          <Section label={t("detail.voice")} colors={colors}>
            <Text style={[styles.body, { color: colors.foreground }]}>
              {engram.voiceProfile.speechStyle}
            </Text>
            {engram.voiceProfile.sampleLines?.length ? (
              <View style={{ marginTop: 10, gap: 6 }}>
                {engram.voiceProfile.sampleLines.slice(0, 2).map((line, i) => (
                  <Text
                    key={i}
                    style={[styles.sample, { color: colors.secondaryForeground }]}
                  >
                    “{line}”
                  </Text>
                ))}
              </View>
            ) : null}
          </Section>

          <Section label={t("detail.drivePressure")} colors={colors}>
            <View style={{ gap: 14 }}>
              {engram.drives.map((drive) => {
                const pressure = engram.driveState?.[drive.id] ?? 0;
                const norm = pressure / Math.max(engram.initiationThreshold, 0.0001);
                const color =
                  norm >= 0.85
                    ? colors.destructive
                    : norm >= 0.5
                      ? colors.accent
                      : colors.primary;
                return (
                  <View key={drive.id} style={{ gap: 6 }}>
                    <View style={styles.driveRow}>
                      <Text
                        style={[styles.driveLabel, { color: colors.foreground }]}
                      >
                        {drive.label}
                      </Text>
                      <Text
                        style={[styles.driveNum, { color: colors.mutedForeground }]}
                      >
                        {pressure.toFixed(2)} / {engram.initiationThreshold}
                      </Text>
                    </View>
                    <ScoreBar value={norm} color={color} />
                  </View>
                );
              })}
            </View>
          </Section>

          <Section label={t("detail.focusThemes")} colors={colors}>
            <View style={styles.themeWrap}>
              {engram.focusThemes.map((t, i) => (
                <Chip key={i} label={t} tone="violet" />
              ))}
            </View>
          </Section>

          <Section label={t("detail.baseline")} colors={colors}>
            <View style={{ gap: 12 }}>
              <Metric
                metricKey="valence"
                label={t("detail.valence")}
                value={engram.emotionalBaseline.valence}
                colors={colors}
              />
              <Metric
                metricKey="arousal"
                label={t("detail.arousal")}
                value={engram.emotionalBaseline.arousal}
                colors={colors}
              />
              <Metric
                metricKey="volatility"
                label={t("detail.volatility")}
                value={engram.emotionalBaseline.volatility}
                colors={colors}
              />
            </View>
          </Section>
        </ScrollView>
      )}

      {engram ? (
        <View
          style={[
            styles.footer,
            {
              paddingBottom: (Platform.OS === "web" ? 34 : insets.bottom) + 12,
              borderTopColor: colors.border,
              backgroundColor: colors.background,
            },
          ]}
        >
          <PrimaryButton
            testID="activate-button"
            label={isActive ? t("detail.activeEngram") : t("detail.makeActive")}
            onPress={onActivate}
            loading={activate.isPending}
            disabled={isActive}
          />
        </View>
      ) : null}
    </View>
  );
}

function Section({
  label,
  children,
  colors,
}: {
  label: string;
  children: React.ReactNode;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.section}>
      <MonoLabel style={{ marginBottom: 10 }}>{label}</MonoLabel>
      <View
        style={[
          styles.sectionCard,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: colors.radius,
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

function Metric({
  metricKey,
  label,
  value,
  colors,
}: {
  metricKey: string;
  label: string;
  value: number;
  colors: ReturnType<typeof useColors>;
}) {
  // valence ranges -1..1; map to 0..1 for the bar.
  const norm = metricKey === "valence" ? (value + 1) / 2 : value;
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.driveRow}>
        <MonoLabel>{label}</MonoLabel>
        <Text style={[styles.driveNum, { color: colors.mutedForeground }]}>
          {value.toFixed(2)}
        </Text>
      </View>
      <ScoreBar value={norm} color={colors.secondaryForeground} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { padding: 20 },
  hero: {
    flexDirection: "row",
    gap: 16,
    alignItems: "center",
    marginBottom: 8,
  },
  heroBody: { flex: 1, gap: 4 },
  name: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 26,
    letterSpacing: 0.5,
  },
  title: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
  heroChips: {
    flexDirection: "row",
    gap: 6,
    marginTop: 6,
  },
  section: { marginTop: 24 },
  sectionCard: {
    borderWidth: 1,
    padding: 16,
  },
  body: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    lineHeight: 23,
  },
  sample: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    fontStyle: "italic",
    lineHeight: 21,
  },
  driveRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  driveLabel: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 15,
  },
  driveNum: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
  },
  themeWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
  },
});
