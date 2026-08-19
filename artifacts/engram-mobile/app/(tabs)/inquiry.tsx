import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Chip, EmptyState, MonoLabel, PrimaryButton } from "@/components/ui";
import { useEngram } from "@/context/engram-context";
import { useColors } from "@/hooks/useColors";
import { resolveReplyLanguage } from "@/lib/i18n";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetEngramQueryKey,
  getListEngramInquiriesQueryKey,
  useCreateEngramInquiry,
  useGetEngram,
  useListEngramInquiries,
} from "@workspace/api-client-react";


type Mode = "probe" | "develop";

export default function InquiryScreen() {
  const { t } = useTranslation("mobile");
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { selectedEngramId } = useEngram();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const engramId = selectedEngramId ?? 0;
  const enabled = selectedEngramId != null;

  const [mode, setMode] = useState<Mode>("probe");
  const [question, setQuestion] = useState("");

  const { data: engram } = useGetEngram(engramId, {
    query: { enabled, queryKey: getGetEngramQueryKey(engramId) },
  });
  const { data: inquiries } = useListEngramInquiries(engramId, {
    query: { enabled, queryKey: getListEngramInquiriesQueryKey(engramId) },
  });
  const create = useCreateEngramInquiry();

  const onSubmit = useCallback(async () => {
    if (!enabled || question.trim().length === 0) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    try {
      await create.mutateAsync({
        id: engramId,
        data: {
          kind: mode,
          question: question.trim(),
          language: await resolveReplyLanguage(),
        },
      });
      setQuestion("");
      queryClient.invalidateQueries({
        queryKey: getListEngramInquiriesQueryKey(engramId),
      });
      if (mode === "develop") {
        queryClient.invalidateQueries({
          queryKey: getGetEngramQueryKey(engramId),
        });
      }
    } catch {
      // ignore
    }
  }, [create, enabled, engramId, mode, question, queryClient]);

  if (!enabled) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={{ paddingTop: topPad }} />
        <EmptyState
          icon={
            <Feather name="help-circle" size={28} color={colors.mutedForeground} />
          }
          title={t("inquiry.noEngram")}
          subtitle={t("inquiry.noEngramSubtitle")}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Text style={[styles.kicker, { color: colors.primary }]}>
          {t("inquiry.kicker")} // {engram?.symbol ?? "··"}
        </Text>
        <Text style={[styles.h1, { color: colors.foreground }]}>
          {t("inquiry.title")}
        </Text>
      </View>

      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.modeRow}>
          {(["probe", "develop"] as Mode[]).map((m) => {
            const active = mode === m;
            return (
              <Pressable
                key={m}
                testID={`mode-${m}`}
                onPress={() => setMode(m)}
                style={[
                  styles.modeChip,
                  {
                    borderColor: active ? colors.primary : colors.border,
                    backgroundColor: active
                      ? colors.primary + "1A"
                      : colors.card,
                    borderRadius: colors.radius,
                  },
                ]}
              >
                <Text
                  style={{
                    fontFamily: "Rajdhani_600SemiBold",
                    fontSize: 15,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                    color: active ? colors.primary : colors.mutedForeground,
                  }}
                >
                  {m === "probe" ? t("inquiry.probe") : t("inquiry.develop")}
                </Text>
                <Text
                  style={{
                    fontFamily: "Inter_400Regular",
                    fontSize: 11,
                    color: colors.mutedForeground,
                    marginTop: 2,
                  }}
                >
                  {m === "probe" ? t("inquiry.probeHint") : t("inquiry.developHint")}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <TextInput
          testID="inquiry-input"
          value={question}
          onChangeText={setQuestion}
          placeholder={
            mode === "probe"
              ? t("inquiry.probePlaceholder")
              : t("inquiry.developPlaceholder")
          }
          placeholderTextColor={colors.mutedForeground}
          multiline
          style={[
            styles.input,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              color: colors.foreground,
              borderRadius: colors.radius,
            },
          ]}
        />

        <PrimaryButton
          testID="inquiry-submit"
          label={mode === "probe" ? t("inquiry.probe") : t("inquiry.develop")}
          tone={mode === "develop" ? "accent" : "primary"}
          loading={create.isPending}
          disabled={question.trim().length === 0}
          onPress={onSubmit}
          style={{ marginTop: 14 }}
        />

        <MonoLabel style={{ marginTop: 28, marginBottom: 12 }}>
          {t("inquiry.history")}
        </MonoLabel>

        {(inquiries ?? []).length === 0 ? (
          <Text style={[styles.emptyHist, { color: colors.mutedForeground }]}>
            {t("inquiry.noInquiries")}
          </Text>
        ) : (
          (inquiries ?? []).map((item) => (
            <View
              key={item.id}
              style={[
                styles.inqCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                },
              ]}
            >
              <Chip
                label={item.kind}
                tone={item.kind === "develop" ? "accent" : "primary"}
              />
              <Text style={[styles.q, { color: colors.foreground }]}>
                {item.question}
              </Text>
              <Text style={[styles.a, { color: colors.mutedForeground }]}>
                {item.response}
              </Text>
              {item.configDelta &&
              Object.keys(item.configDelta).length > 0 ? (
                <View
                  style={[
                    styles.delta,
                    { borderColor: colors.accent + "55" },
                  ]}
                >
                  <MonoLabel color={colors.accent}>
                    {t("inquiry.configDelta")}
                  </MonoLabel>
                  <Text
                    style={[styles.deltaText, { color: colors.secondaryForeground }]}
                  >
                    {JSON.stringify(item.configDelta, null, 2)}
                  </Text>
                </View>
              ) : null}
            </View>
          ))
        )}
        <View style={{ height: 120 }} />
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 4,
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
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  modeRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  modeChip: {
    flex: 1,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  input: {
    borderWidth: 1,
    padding: 14,
    minHeight: 96,
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    textAlignVertical: "top",
  },
  emptyHist: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
  },
  inqCard: {
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
    gap: 8,
  },
  q: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 16,
  },
  a: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 21,
  },
  delta: {
    borderWidth: 1,
    borderRadius: 6,
    padding: 10,
    marginTop: 4,
    gap: 6,
  },
  deltaText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    lineHeight: 16,
  },
});
