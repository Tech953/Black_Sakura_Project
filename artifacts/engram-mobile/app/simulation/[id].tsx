import { Feather } from "@expo/vector-icons";
import { Stack, useLocalSearchParams } from "expo-router";
import React, { useMemo } from "react";
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

import { Chip, EmptyState, MonoLabel, ScoreBar } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import {
  getListSimulationStepsQueryKey,
  useListEngrams,
  useListSimulationSteps,
  useListSimulations,
} from "@workspace/api-client-react";

export default function SimulationDetailScreen() {
  const { t } = useTranslation("mobile");
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Number(params.id);
  const validId = Number.isInteger(id) && id > 0;
  const simulations = useListSimulations();
  const steps = useListSimulationSteps(id, {
    query: { enabled: validId, queryKey: getListSimulationStepsQueryKey(id) },
  });
  const engrams = useListEngrams();
  const simulation = simulations.data?.find((item) => item.id === id);
  const engramById = useMemo(
    () => new Map((engrams.data ?? []).map((engram) => [engram.id, engram.name])),
    [engrams.data],
  );

  const isLoading = simulations.isLoading || steps.isLoading;
  const isError = !validId || simulations.isError || steps.isError;
  const retry = () => {
    void Promise.all([simulations.refetch(), steps.refetch()]);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: simulation?.premise ?? t("simulation.title"),
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
      ) : isError || !simulation ? (
        <View style={styles.center}>
          <EmptyState
            icon={<Feather name="box" size={28} color={colors.mutedForeground} />}
            title={t("simulation.unavailable")}
            subtitle={t("simulation.unavailableSubtitle")}
          />
          <Text
            onPress={retry}
            style={[styles.retry, { color: colors.primary }]}
          >
            {t("simulation.retry")}
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: (Platform.OS === "web" ? 34 : insets.bottom) + 40 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View
            style={[
              styles.notice,
              { backgroundColor: colors.card, borderColor: colors.violet + "66" },
            ]}
          >
            <Feather name="shield" size={16} color={colors.violet} />
            <View style={styles.noticeBody}>
              <Text style={[styles.noticeTitle, { color: colors.violet }]}>
                {t("simulation.simulatedLabel")}
              </Text>
              <Text style={[styles.noticeText, { color: colors.mutedForeground }]}>
                {t("simulation.quarantineNotice")}
              </Text>
            </View>
          </View>

          <Text style={[styles.kicker, { color: colors.primary }]}>
            {t("simulation.kicker")}
          </Text>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {t("simulation.title")}
          </Text>
          <View style={styles.statusRow}>
            <Chip
              label={t(`simulation.status.${simulation.status}`)}
              tone={simulation.status === "ended" ? "muted" : "accent"}
            />
            <Text style={[styles.statusMeta, { color: colors.mutedForeground }]}>
              {t("simulation.runId", { id: simulation.id })}
            </Text>
          </View>

          <Section label={t("simulation.premise")} colors={colors}>
            <Text style={[styles.body, { color: colors.foreground }]}>
              {simulation.premise}
            </Text>
          </Section>

          <Section label={t("simulation.progress")} colors={colors}>
            <View style={styles.progressHeader}>
              <Text style={[styles.body, { color: colors.foreground }]}>
                {t("simulation.stepProgress", {
                  current: simulation.currentStep,
                  max: simulation.maxSteps,
                })}
              </Text>
              <Text style={[styles.statusMeta, { color: colors.violet }]}>
                {Math.round(
                  (simulation.currentStep / Math.max(simulation.maxSteps, 1)) * 100,
                )}
                %
              </Text>
            </View>
            <ScoreBar
              value={simulation.currentStep / Math.max(simulation.maxSteps, 1)}
              color={colors.violet}
            />
          </Section>

          <Section label={t("simulation.steps")} colors={colors}>
            {!steps.data?.length ? (
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                {t("simulation.noSteps")}
              </Text>
            ) : (
              <View style={styles.stepList}>
                {steps.data.map((step) => (
                  <View
                    key={step.id}
                    style={[styles.step, { borderBottomColor: colors.border }]}
                  >
                    <View style={styles.stepHeader}>
                      <Text style={[styles.stepNumber, { color: colors.primary }]}>
                        {t("simulation.stepNumber", { number: step.stepNumber })}
                      </Text>
                      <Chip label={t("simulation.simulatedLabel")} tone="violet" />
                    </View>
                    <Text style={[styles.stepSpeaker, { color: colors.mutedForeground }]}>
                      {step.speakerEngramId
                        ? engramById.get(step.speakerEngramId) ??
                          t("simulation.unknownSpeaker")
                        : t("simulation.unknownSpeaker")}
                    </Text>
                    <Text style={[styles.body, { color: colors.foreground }]}>
                      {step.narrative}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </Section>

          <Section label={t("simulation.exitSummary")} colors={colors}>
            <Text style={[styles.body, { color: colors.foreground }]}>
              {simulation.exitSummary ?? t("simulation.noExitSummary")}
            </Text>
          </Section>
        </ScrollView>
      )}
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
      <MonoLabel color={colors.mutedForeground} style={{ marginBottom: 10 }}>
        {label}
      </MonoLabel>
      <View
        style={[
          styles.sectionCard,
          { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  retry: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 15,
    letterSpacing: 0.8,
    marginTop: 18,
    textTransform: "uppercase",
  },
  scroll: { padding: 20 },
  notice: {
    flexDirection: "row",
    gap: 10,
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    marginBottom: 24,
  },
  noticeBody: { flex: 1, gap: 4 },
  noticeTitle: {
    fontFamily: "JetBrainsMono_500Medium",
    fontSize: 11,
    letterSpacing: 1.2,
  },
  noticeText: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  kicker: {
    fontFamily: "JetBrainsMono_500Medium",
    fontSize: 11,
    letterSpacing: 2,
  },
  title: { fontFamily: "Rajdhani_700Bold", fontSize: 34, marginTop: 4 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  statusMeta: { fontFamily: "JetBrainsMono_400Regular", fontSize: 10 },
  section: { marginTop: 24 },
  sectionCard: { borderWidth: 1, padding: 16 },
  body: { fontFamily: "Inter_400Regular", fontSize: 15, lineHeight: 23 },
  progressHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  stepList: { gap: 0 },
  step: { gap: 8, paddingVertical: 12, borderBottomWidth: 1 },
  stepHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  stepNumber: { fontFamily: "JetBrainsMono_500Medium", fontSize: 11, letterSpacing: 1 },
  stepSpeaker: { fontFamily: "JetBrainsMono_400Regular", fontSize: 10 },
  emptyText: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 20 },
});