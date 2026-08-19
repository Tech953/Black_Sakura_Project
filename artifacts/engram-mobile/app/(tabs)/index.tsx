import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EngramCard } from "@/components/engram-card";
import { EmptyState } from "@/components/ui";
import { useEngram } from "@/context/engram-context";
import { useColors } from "@/hooks/useColors";
import {
  getListEngramsQueryKey,
  useActivateEngram,
  useListEngrams,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

export default function EngramsScreen() {
  const { t } = useTranslation("mobile");
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { selectedEngramId, setSelectedEngramId } = useEngram();
  const { data: engrams, isLoading, isError, refetch, isRefetching } =
    useListEngrams();
  const activate = useActivateEngram();

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const onSelect = useCallback(
    async (id: number) => {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
      setSelectedEngramId(id);
      try {
        await activate.mutateAsync({ id });
        queryClient.invalidateQueries({ queryKey: getListEngramsQueryKey() });
      } catch {
        // selection is local even if activate fails
      }
      router.push(`/engram/${id}`);
    },
    [activate, queryClient, router, setSelectedEngramId],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={styles.headerTopRow}>
          <Text style={[styles.kicker, { color: colors.primary }]}>
            {t("personas.kicker")}
          </Text>
          <Pressable
            onPress={() => router.push("/server-settings")}
            hitSlop={12}
            accessibilityLabel={t("personas.serverSettings")}
          >
            <Feather name="settings" size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>
        <Text style={[styles.h1, { color: colors.foreground }]}>
          {t("personas.title")}
        </Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          {t("personas.subtitle")}
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <EmptyState
            icon={
              <Feather name="wifi-off" size={28} color={colors.mutedForeground} />
            }
            title={t("personas.connectionLost")}
            subtitle={t("personas.connectionLostSubtitle")}
          />
          <Pressable
            onPress={() => refetch()}
            style={({ pressed }) => [
              styles.retryButton,
              {
                borderColor: colors.primary,
                backgroundColor: colors.card,
                opacity: pressed || isRefetching ? 0.6 : 1,
              },
            ]}
            accessibilityLabel={t("personas.retryConnection")}
          >
            {isRefetching ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Feather name="refresh-cw" size={16} color={colors.primary} />
            )}
            <Text style={[styles.retryText, { color: colors.primary }]}>
              {t("personas.retry")}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/server-settings")}
            hitSlop={8}
            accessibilityLabel={t("personas.openServerSettings")}
          >
            <Text style={[styles.retryLink, { color: colors.mutedForeground }]}>
              {t("personas.checkServerLink")}
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={engrams ?? []}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          scrollEnabled={!!engrams && engrams.length > 0}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => (
            <EngramCard
              engram={item}
              selected={item.id === selectedEngramId}
              onPress={() => onSelect(item.id)}
            />
          )}
          ListEmptyComponent={
            <View style={{ height: 400 }}>
              <EmptyState
                icon={
                  <Feather name="cpu" size={28} color={colors.mutedForeground} />
                }
                title={t("personas.empty")}
                subtitle={t("personas.emptySubtitle")}
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
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 4,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  kicker: {
    fontFamily: "JetBrainsMono_500Medium",
    fontSize: 11,
    letterSpacing: 2,
  },
  h1: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 34,
    letterSpacing: 0.5,
  },
  sub: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 2,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 120,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 20,
  },
  retryText: {
    fontFamily: "JetBrainsMono_500Medium",
    fontSize: 13,
    letterSpacing: 2,
  },
  retryLink: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    marginTop: 14,
    textDecorationLine: "underline",
  },
});
