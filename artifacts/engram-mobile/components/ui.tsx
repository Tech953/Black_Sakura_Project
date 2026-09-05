import React from "react";
import {
  ActivityIndicator,
  Pressable,
  PressableProps,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { useTranslation } from "react-i18next";
import { isRtlLanguage } from "@/lib/layout-direction";

export function MonoLabel({
  children,
  color,
  style,
}: {
  children: React.ReactNode;
  color?: string;
  style?: TextStyle;
}) {
  const colors = useColors();
  const { i18n } = useTranslation();
  const rtl = isRtlLanguage(i18n.resolvedLanguage ?? i18n.language);
  return (
    <Text
      style={[
        {
          fontFamily: "JetBrainsMono_500Medium",
          fontSize: 11,
          letterSpacing: 1.5,
          textTransform: "uppercase",
          color: color ?? colors.mutedForeground,
          ...(rtl
            ? {
                fontFamily: undefined,
                letterSpacing: 0,
                textTransform: "none" as const,
                writingDirection: "rtl" as const,
                textAlign: "right" as const,
              }
            : null),
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Chip({
  label,
  tone = "muted",
}: {
  label: string;
  tone?: "muted" | "primary" | "accent" | "violet" | "success";
}) {
  const colors = useColors();
  const { i18n } = useTranslation();
  const rtl = isRtlLanguage(i18n.resolvedLanguage ?? i18n.language);
  const toneColor =
    tone === "primary"
      ? colors.primary
      : tone === "accent"
        ? colors.accent
        : tone === "violet"
          ? colors.violet
          : tone === "success"
            ? colors.success
            : colors.mutedForeground;
  return (
    <View
      style={[
        styles.chip,
        { borderColor: toneColor + "55", backgroundColor: toneColor + "14" },
      ]}
    >
      <Text
        style={{
          fontFamily: "JetBrainsMono_500Medium",
          fontSize: 10,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: toneColor,
          ...(rtl
            ? {
                fontFamily: undefined,
                letterSpacing: 0,
                textTransform: "none" as const,
                writingDirection: "rtl" as const,
              }
            : null),
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export function ScoreBar({
  value,
  color,
}: {
  value: number;
  color?: string;
}) {
  const colors = useColors();
  const { i18n } = useTranslation();
  const rtl = isRtlLanguage(i18n.resolvedLanguage ?? i18n.language);
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <View style={[styles.barTrack, { backgroundColor: colors.muted }]}>
      <View
        style={[
          styles.barFill,
          {
            width: `${pct}%`,
            backgroundColor: color ?? colors.primary,
            alignSelf: rtl ? "flex-end" : "flex-start",
          },
        ]}
      />
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
  tone = "primary",
  style,
  testID,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  tone?: "primary" | "accent" | "outline";
  style?: ViewStyle;
  testID?: string;
}) {
  const colors = useColors();
  const isOutline = tone === "outline";
  const bg =
    tone === "accent"
      ? colors.accent
      : tone === "primary"
        ? colors.primary
        : "transparent";
  const fg =
    tone === "accent"
      ? colors.accentForeground
      : tone === "primary"
        ? colors.primaryForeground
        : colors.primary;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: bg,
          borderColor: isOutline ? colors.border : "transparent",
          borderWidth: isOutline ? 1 : 0,
          opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
          borderRadius: colors.radius,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <Text
          style={{
            fontFamily: "Rajdhani_600SemiBold",
            fontSize: 15,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: fg,
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function IconButton({
  children,
  ...props
}: PressableProps & { children: React.ReactNode }) {
  const colors = useColors();
  return (
    <Pressable
      {...props}
      style={({ pressed }) => [
        styles.iconButton,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {children}
    </Pressable>
  );
}

export function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  const colors = useColors();
  return (
    <View style={styles.empty}>
      <View
        style={[
          styles.emptyIcon,
          { borderColor: colors.border, backgroundColor: colors.card },
        ]}
      >
        {icon}
      </View>
      <Text
        style={{
          fontFamily: "Rajdhani_600SemiBold",
          fontSize: 18,
          color: colors.foreground,
          marginTop: 16,
          textAlign: "center",
        }}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text
          style={{
            fontFamily: "Inter_400Regular",
            fontSize: 14,
            color: colors.mutedForeground,
            marginTop: 6,
            textAlign: "center",
            lineHeight: 20,
            maxWidth: 280,
          }}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  barTrack: {
    height: 5,
    borderRadius: 3,
    overflow: "hidden",
    width: "100%",
  },
  barFill: {
    height: 5,
    borderRadius: 3,
  },
  button: {
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    paddingHorizontal: 20,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
