import { Feather } from "@expo/vector-icons";
import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Glyph } from "@/components/glyph";
import { Chip } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import type { Engram } from "@workspace/api-client-react";

export function EngramCard({
  engram,
  selected,
  onPress,
}: {
  engram: Engram;
  selected: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation("mobile");
  const colors = useColors();
  const mood = engram.currentMood || engram.emotionalBaseline.mood;
  return (
    <Pressable
      testID={`engram-card-${engram.id}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: selected ? colors.primary : colors.border,
          borderRadius: colors.radius,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.row}>
        <Glyph symbol={engram.symbol} active={selected} />
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text
              numberOfLines={1}
              style={[styles.name, { color: colors.foreground }]}
            >
              {engram.name}
            </Text>
            {selected ? (
              <View style={[styles.dot, { backgroundColor: colors.primary }]} />
            ) : null}
          </View>
          <Text
            numberOfLines={1}
            style={[styles.title, { color: colors.mutedForeground }]}
          >
            {engram.title}
          </Text>
          <View style={styles.chips}>
            <Chip label={mood} tone="primary" />
            {engram.autonomyEnabled ? (
              <Chip label={t("card.autonomous")} tone="success" />
            ) : (
              <Chip label={t("card.dormant")} tone="muted" />
            )}
          </View>
        </View>
        <Feather
          name="chevron-right"
          size={20}
          color={colors.mutedForeground}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  body: {
    flex: 1,
    gap: 4,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  name: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 19,
    letterSpacing: 0.5,
    flexShrink: 1,
  },
  title: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
  },
  chips: {
    flexDirection: "row",
    gap: 6,
    marginTop: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
