import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useMemo } from "react";
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
import {
  getEngramListModeQueryKey,
  useEngram,
} from "@/context/engram-context";
import { useColors } from "@/hooks/useColors";
import { useOfflineMode } from "@/lib/offline/mode";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetEngramQueryKey,
  getListEngramWorldModelQueryKey,
  getListMediaQueryKey,
  useListBeliefs,
  useListEngramWorldModel,
  useListMemories,
  useListMedia,
  useActivateEngram,
  useGetEngram,
  type WorldModelEntry,
} from "@workspace/api-client-react";

function mediaAssetId(source: string | undefined): number | null {
  if (!source?.startsWith("media:")) return null;
  const id = Number(source.slice("media:".length));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export default function EngramDetailScreen() {
  const { t } = useTranslation("mobile");
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Number(params.id);
  const offlineActive = useOfflineMode();
  const { selectedEngramId, setSelectedEngramId } = useEngram();
  const { data: memories } = useListMemories();
  const { data: beliefs } = useListBeliefs();
  const { data: worldModel } = useListEngramWorldModel(id, {
    query: {
      enabled: !Number.isNaN(id),
      queryKey: getListEngramWorldModelQueryKey(id),
    },
  });
  const { data: mediaAssets } = useListMedia(
    Number.isNaN(id) ? undefined : { engramId: id },
    {
      query: {
        enabled: !Number.isNaN(id),
        queryKey: getListMediaQueryKey(Number.isNaN(id) ? undefined : { engramId: id }),
      },
    },
  );
  const mediaById = useMemo(
    () => new Map((mediaAssets ?? []).map((asset) => [asset.id, asset])),
    [mediaAssets],
  );
  const mediaObservations = useMemo(
    () =>
      (worldModel ?? []).filter(
        (entry): entry is WorldModelEntry =>
          entry.provenance === "observed" && mediaAssetId(entry.source) !== null,
      ),
    [worldModel],
  );

  const { data: engram, isLoading, isError, refetch } = useGetEngram(id, {
    query: {
      enabled: !Number.isNaN(id),
      queryKey: [
        ...getGetEngramQueryKey(id),
        offlineActive ? "offline-selection" : "online-selection",
      ],
    },
  });
  const activate = useActivateEngram();

  const isActive = selectedEngramId === id;

  const onActivate = useCallback(async () => {
    if (engram?.isArchival === true) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    setSelectedEngramId(id, engram?.slug);
    try {
      await activate.mutateAsync({ id });
      void queryClient.invalidateQueries({
        queryKey: getEngramListModeQueryKey(offlineActive),
      });
      // Dismiss back to the root route rather than relying on the Android
      // back-stack shape. This also handles a detail screen opened by a link.
      router.dismissTo("/");
    } catch {
      // Keep the detail screen mounted so a transient activation failure does
      // not look like an app crash or strand the user on a blank route.
    }
  }, [
    activate,
    engram?.isArchival,
    engram?.slug,
    id,
    offlineActive,
    queryClient,
    router,
    setSelectedEngramId,
  ]);

  const onOpenPreservedTranscript = useCallback(() => {
    setSelectedEngramId(id, engram?.slug);
    router.dismissTo("/(tabs)/chat");
  }, [engram?.slug, id, router, setSelectedEngramId]);

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
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : isError || !engram ? (
        <View style={styles.errorState}>
          <Text style={[styles.errorText, { color: colors.destructive }]}>
            {t("errors.message")}
          </Text>
          <PrimaryButton
            label={t("errors.tryAgain")}
            tone="outline"
            onPress={() => void refetch()}
            style={{ marginTop: 14, minWidth: 150 }}
          />
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
                {engram.isArchival ? (
                  <Chip label={t("chat.archived")} tone="muted" />
                ) : null}
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

          <Section label={t("detail.memory")} colors={colors}>
            {(memories ?? []).slice(0, 5).map((memory) => (
              <View key={memory.id} style={styles.dataRow}>
                <View style={styles.dataRowTop}>
                  <Chip label={memory.layer} tone="primary" />
                  <Text style={[styles.dataMeta, { color: colors.mutedForeground }]}>
                    {Math.round(memory.confidence * 100)}%
                  </Text>
                </View>
                <Text style={[styles.body, { color: colors.foreground }]}>
                  {memory.content}
                </Text>
              </View>
            ))}
            {!memories?.length ? (
              <Text style={[styles.emptyData, { color: colors.mutedForeground }]}>
                {t("detail.noMemory")}
              </Text>
            ) : null}
          </Section>

          <Section label={t("detail.mediaMemory", { defaultValue: "Media observations" })} colors={colors}>
            {mediaObservations.map((observation) => {
              const assetId = mediaAssetId(observation.source)!;
              const asset = mediaById.get(assetId);
              return (
                <View key={observation.id} style={styles.dataRow}>
                  <View style={styles.dataRowTop}>
                    <Chip label={observation.provenance} tone="success" />
                    <Text style={[styles.dataMeta, { color: colors.mutedForeground }]}>
                      {Math.round(observation.confidence * 100)}%
                    </Text>
                  </View>
                  <Text style={[styles.body, { color: colors.foreground }]}>
                    {observation.content}
                  </Text>
                  <PrimaryButton
                    label={asset?.filename ?? t("detail.openMediaSource", { defaultValue: "Open source asset" })}
                    tone="outline"
                    onPress={() =>
                      router.push({
                        pathname: "/(tabs)/media",
                        params: { asset: String(assetId) },
                      })
                    }
                    style={{ marginTop: 10 }}
                  />
                </View>
              );
            })}
            {!mediaObservations.length ? (
              <Text style={[styles.emptyData, { color: colors.mutedForeground }]}>
                {t("detail.noMediaMemory", { defaultValue: "No media observations are available yet." })}
              </Text>
            ) : null}
          </Section>

          <Section label={t("detail.beliefs")} colors={colors}>
            {(beliefs ?? []).slice(0, 5).map((belief) => (
              <View key={belief.id} style={styles.dataRow}>
                <View style={styles.dataRowTop}>
                  <MonoLabel color={colors.accent} style={styles.localizedMeta}>
                    {Math.round(belief.confidence * 100)}% {t("detail.confident")}
                  </MonoLabel>
                  <MonoLabel
                    color={colors.mutedForeground}
                    style={styles.localizedMeta}
                  >
                    {t("detail.revisions", { count: belief.revisionCount })}
                  </MonoLabel>
                </View>
                <Text style={[styles.body, { color: colors.foreground }]}>
                  {belief.statement}
                </Text>
              </View>
            ))}
            {!beliefs?.length ? (
              <Text style={[styles.emptyData, { color: colors.mutedForeground }]}>
                {t("detail.noBeliefs")}
              </Text>
            ) : null}
          </Section>

          <Section label={t("detail.environment")} colors={colors}>
            <Text style={[styles.body, { color: colors.foreground }]}>
              {engram.environmentAnchor.description}
            </Text>
            <View style={{ marginTop: 14, gap: 8 }}>
              <Text style={[styles.dataMeta, { color: colors.primary }]}>
                {engram.environmentAnchor.name}
              </Text>
              <Text style={[styles.dataMeta, { color: colors.mutedForeground }]}>
                {engram.environmentAnchor.ambient}
              </Text>
            </View>
            <PrimaryButton
              label={t("detail.openEnvironment")}
              tone="outline"
              onPress={() => router.push(`/engram/environment?id=${id}`)}
              style={{ marginTop: 14 }}
            />
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
            label={
              engram.isArchival
                ? t("chat.history")
                : isActive
                  ? t("detail.activeEngram")
                  : t("detail.makeActive")
            }
            onPress={
              engram.isArchival ? onOpenPreservedTranscript : onActivate
            }
            loading={!engram.isArchival && activate.isPending}
            disabled={!engram.isArchival && isActive}
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
  errorState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  errorText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  scroll: { padding: 20 },
  hero: {
    flexDirection: "row",
    gap: 16,
    alignItems: "center",
    marginBottom: 8,
  },
  heroBody: { flex: 1, minWidth: 0, gap: 4 },
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
    flexWrap: "wrap",
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
  dataRow: { gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "rgba(148,163,184,0.14)" },
  dataRowTop: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  dataMeta: { fontFamily: "JetBrainsMono_400Regular", fontSize: 10, textTransform: "uppercase" },
  localizedMeta: { fontSize: 10, flexShrink: 1 },
  emptyData: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 20 },
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
