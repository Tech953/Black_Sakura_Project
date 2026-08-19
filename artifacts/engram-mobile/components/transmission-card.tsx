import React from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import type { TFunction } from "i18next";

import { Chip, MonoLabel, ScoreBar } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import type { EngramTransmission } from "@workspace/api-client-react";

function relativeTime(t: TFunction<"mobile">, iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60000);
  if (m < 1) return t("feed.justNow");
  if (m < 60) return t("feed.minutesAgo", { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("feed.hoursAgo", { count: h });
  return t("feed.daysAgo", { count: Math.floor(h / 24) });
}

export function TransmissionCard({
  transmission,
}: {
  transmission: EngramTransmission;
}) {
  const { t } = useTranslation("mobile");
  const colors = useColors();
  const score = transmission.overallScore ?? 0;
  const scoreColor =
    score >= 0.66 ? colors.primary : score >= 0.33 ? colors.accent : colors.violet;
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
          opacity: transmission.seen ? 0.7 : 1,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {transmission.drive ? (
            <Chip label={transmission.drive} tone="primary" />
          ) : null}
          {transmission.kind ? (
            <Chip label={transmission.kind} tone="muted" />
          ) : null}
        </View>
        <MonoLabel>{relativeTime(t, transmission.createdAt)}</MonoLabel>
      </View>

      <Text style={[styles.content, { color: colors.foreground }]}>
        {transmission.content}
      </Text>

      <View style={styles.footer}>
        <View style={styles.scoreRow}>
          <MonoLabel style={{ width: 64 }}>{t("feed.signal")}</MonoLabel>
          <View style={{ flex: 1 }}>
            <ScoreBar value={score} color={scoreColor} />
          </View>
          <Text style={[styles.scoreNum, { color: colors.mutedForeground }]}>
            {Math.round(score * 100)}
          </Text>
        </View>
        {transmission.mood ? (
          <MonoLabel color={colors.secondaryForeground}>
            {t("feed.mood")} · {transmission.mood}
          </MonoLabel>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: "row",
    gap: 6,
    flexShrink: 1,
  },
  content: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    lineHeight: 23,
  },
  footer: {
    marginTop: 14,
    gap: 8,
  },
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  scoreNum: {
    fontFamily: "JetBrainsMono_500Medium",
    fontSize: 12,
    width: 28,
    textAlign: "right",
  },
});
