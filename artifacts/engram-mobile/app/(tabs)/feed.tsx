import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TransmissionCard } from "@/components/transmission-card";
import { EmptyState, IconButton } from "@/components/ui";
import { useEngram } from "@/context/engram-context";
import { useColors } from "@/hooks/useColors";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetEngramQueryKey,
  getListEngramTransmissionsQueryKey,
  useGetEngram,
  useListEngramTransmissions,
  useMarkTransmissionsSeen,
  useTransmitEngram,
} from "@workspace/api-client-react";

export default function FeedScreen() {
  const { t } = useTranslation("mobile");
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { selectedEngramId } = useEngram();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const engramId = selectedEngramId ?? 0;
  const enabled = selectedEngramId != null;

  const { data: engram } = useGetEngram(engramId, {
    query: { enabled, queryKey: getGetEngramQueryKey(engramId) },
  });
  const { data: transmissions, isLoading } = useListEngramTransmissions(
    engramId,
    {
      query: {
        enabled,
        refetchInterval: 5000,
        queryKey: getListEngramTransmissionsQueryKey(engramId),
      },
    },
  );
  const transmit = useTransmitEngram();
  const markSeen = useMarkTransmissionsSeen();

  const unseenIds = useMemo(
    () => (transmissions ?? []).filter((t) => !t.seen).map((t) => t.id),
    [transmissions],
  );

  useEffect(() => {
    if (!enabled || unseenIds.length === 0) return;
    markSeen
      .mutateAsync({ id: engramId, data: { ids: unseenIds } })
      .then(() =>
        queryClient.invalidateQueries({
          queryKey: getListEngramTransmissionsQueryKey(engramId),
        }),
      )
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unseenIds.join(",")]);

  const onPulse = useCallback(async () => {
    if (!enabled) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    try {
      await transmit.mutateAsync({ id: engramId });
      queryClient.invalidateQueries({
        queryKey: getListEngramTransmissionsQueryKey(engramId),
      });
    } catch {
      // ignore
    }
  }, [enabled, engramId, queryClient, transmit]);

  if (!enabled) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={{ paddingTop: topPad }} />
        <EmptyState
          icon={<Feather name="radio" size={28} color={colors.mutedForeground} />}
          title={t("feed.noEngram")}
          subtitle={t("feed.noEngramSubtitle")}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.kicker, { color: colors.primary }]}>
            {t("feed.kicker")} // {engram?.symbol ?? "··"}
          </Text>
          <Text style={[styles.h1, { color: colors.foreground }]}>
            {engram?.name ?? t("feed.fallbackTitle")}
          </Text>
        </View>
        <IconButton
          testID="pulse-button"
          onPress={onPulse}
          disabled={transmit.isPending}
        >
          {transmit.isPending ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : (
            <Feather name="zap" size={20} color={colors.primary} />
          )}
        </IconButton>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={transmissions ?? []}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          scrollEnabled={!!transmissions && transmissions.length > 0}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => <TransmissionCard transmission={item} />}
          ListEmptyComponent={
            <View style={{ height: 360 }}>
              <EmptyState
                icon={
                  <Feather
                    name="activity"
                    size={28}
                    color={colors.mutedForeground}
                  />
                }
                title={t("feed.awaitingSignal")}
                subtitle={t("feed.awaitingSignalSubtitle")}
              />
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  kicker: {
    fontFamily: "JetBrainsMono_500Medium",
    fontSize: 11,
    letterSpacing: 2,
  },
  h1: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 30,
    letterSpacing: 0.5,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 120,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
