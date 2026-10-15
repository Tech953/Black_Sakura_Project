import { Feather } from "@expo/vector-icons";
import React from "react";
import { useTranslation } from "react-i18next";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import {
  formatCrashReport,
  type CrashReport,
} from "@/lib/crash-log";

export function PreviousCrashScreen({
  report,
  onContinue,
}: {
  report: CrashReport;
  onContinue: () => void;
}) {
  const { t } = useTranslation("mobile");
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const details = formatCrashReport(report);

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 24,
          paddingBottom: (Platform.OS === "web" ? 34 : insets.bottom) + 16,
        },
      ]}
    >
      <View style={styles.header}>
        <View
          style={[
            styles.icon,
            { backgroundColor: colors.card, borderColor: colors.destructive },
          ]}
        >
          <Feather name="alert-triangle" size={26} color={colors.destructive} />
        </View>
        <Text style={[styles.kicker, { color: colors.destructive }]}>
          {t("crashRecovery.kicker")}
        </Text>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {t("crashRecovery.title")}
        </Text>
        <Text style={[styles.message, { color: colors.mutedForeground }]}>
          {t("crashRecovery.message")}
        </Text>
      </View>

      <View style={styles.detailsSection}>
        <Text style={[styles.detailsLabel, { color: colors.primary }]}>
          {t("crashRecovery.details")}
        </Text>
        <ScrollView
          style={[
            styles.detailsCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
          contentContainerStyle={styles.detailsContent}
          showsVerticalScrollIndicator
        >
          <Text
            selectable
            selectionColor={colors.primary}
            style={[styles.detailsText, { color: colors.foreground }]}
          >
            {details}
          </Text>
        </ScrollView>
        <Text style={[styles.copyHint, { color: colors.mutedForeground }]}>
          {t("crashRecovery.copyHint")}
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("crashRecovery.continue")}
        onPress={onContinue}
        style={({ pressed }) => [
          styles.continueButton,
          {
            backgroundColor: colors.primary,
            borderRadius: colors.radius,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        <Text
          style={[
            styles.continueText,
            { color: colors.primaryForeground },
          ]}
        >
          {t("crashRecovery.continue")}
        </Text>
        <Feather
          name="arrow-right"
          size={18}
          color={colors.primaryForeground}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    gap: 22,
  },
  header: {
    gap: 8,
  },
  icon: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 14,
    marginBottom: 6,
  },
  kicker: {
    fontFamily: "JetBrainsMono_500Medium",
    fontSize: 11,
    letterSpacing: 2,
  },
  title: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 30,
    lineHeight: 36,
  },
  message: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    lineHeight: 22,
  },
  detailsSection: {
    flex: 1,
    gap: 8,
  },
  detailsLabel: {
    fontFamily: "JetBrainsMono_500Medium",
    fontSize: 11,
    letterSpacing: 1.5,
  },
  detailsCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
  },
  detailsContent: {
    padding: 14,
  },
  detailsText: {
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace",
    }),
    fontSize: 12,
    lineHeight: 18,
  },
  copyHint: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 18,
  },
  continueButton: {
    minHeight: 50,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  continueText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
  },
});