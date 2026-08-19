import { Feather } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { setBaseUrl } from "@workspace/api-client-react";
import { LANGUAGES } from "@workspace/i18n";
import {
  DEFAULT_SERVER_URL,
  getServerUrlOverride,
  normalizeServerUrl,
  setServerUrlOverride,
} from "@/lib/server-url";
import { isOfflineMode, setOfflineMode } from "@/lib/offline/mode";
import {
  MODEL_BYTES,
  MODEL_NAME,
  cancelDownload,
  deleteModel,
  downloadModel,
  getModelStatus,
  type ModelStatus,
} from "@/lib/offline/model";
import { releaseLlm } from "@/lib/offline/llm";
import i18n, {
  getReplyLanguageSetting,
  setReplyLanguageSetting,
  setUiLanguage,
  type ReplyLanguageSetting,
} from "@/lib/i18n";

function gb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(2)} GB`;
}

export default function ServerSettingsScreen() {
  const { t } = useTranslation("mobile");
  const colors = useColors();
  const router = useRouter();
  const [value, setValue] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  // On-device offline mode state
  const [offline, setOffline] = useState(isOfflineMode());
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [offlineMsg, setOfflineMsg] = useState<string | null>(null);

  // Language state
  const [uiLang, setUiLang] = useState(i18n.language);
  const [replyLang, setReplyLang] = useState<ReplyLanguageSetting>("match");

  useEffect(() => {
    getServerUrlOverride().then((override) => {
      setValue(override ?? "");
      setLoaded(true);
    });
    if (Platform.OS !== "web") {
      getModelStatus().then(setModelStatus).catch(() => {});
    }
    getReplyLanguageSetting().then(setReplyLang).catch(() => {});
  }, []);

  useEffect(() => {
    const onLangChange = (lng: string) => setUiLang(lng);
    i18n.on("languageChanged", onLangChange);
    return () => i18n.off("languageChanged", onLangChange);
  }, []);

  const onSelectUiLang = useCallback((code: string) => {
    setUiLang(code);
    void setUiLanguage(code);
  }, []);

  const onSelectReplyLang = useCallback((value: ReplyLanguageSetting) => {
    setReplyLang(value);
    void setReplyLanguageSetting(value);
  }, []);

  const refreshModel = useCallback(() => {
    getModelStatus().then(setModelStatus).catch(() => {});
  }, []);

  const onDownload = useCallback(async () => {
    setOfflineMsg(null);
    setDownloading(true);
    setProgress(0);
    try {
      await downloadModel((written, total) => {
        setProgress(total > 0 ? written / total : 0);
      });
      setOfflineMsg(t("settings.modelReady"));
    } catch (err) {
      setOfflineMsg(err instanceof Error ? err.message : t("settings.downloadFailed"));
    } finally {
      setDownloading(false);
      refreshModel();
    }
  }, [refreshModel, t]);

  const onCancelDownload = useCallback(async () => {
    await cancelDownload();
    setDownloading(false);
    refreshModel();
  }, [refreshModel]);

  const onToggleOffline = useCallback(
    async (on: boolean) => {
      if (on && modelStatus?.state !== "ready") {
        setOfflineMsg(t("settings.downloadFirst"));
        return;
      }
      setOffline(on);
      await setOfflineMode(on);
      if (!on) await releaseLlm().catch(() => {});
      setOfflineMsg(on ? t("settings.offlineActive") : t("settings.backOnline"));
    },
    [modelStatus, t],
  );

  const onDeleteModel = useCallback(async () => {
    await setOfflineMode(false);
    setOffline(false);
    await releaseLlm().catch(() => {});
    await deleteModel();
    refreshModel();
    setOfflineMsg(t("settings.modelDeleted"));
  }, [refreshModel, t]);

  const applyUrl = async (url: string | null) => {
    await setServerUrlOverride(url);
    setBaseUrl(url ?? DEFAULT_SERVER_URL);
  };

  const onSave = async () => {
    setStatus(null);
    const trimmed = value.trim();
    if (!trimmed) {
      await applyUrl(null);
      setStatus(t("settings.usingDefault"));
      return;
    }
    const normalized = normalizeServerUrl(trimmed);
    if (!normalized) {
      setStatus(t("settings.invalidAddress"));
      return;
    }
    setChecking(true);
    let reachable = false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${normalized}/api/healthz`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      reachable = res.ok;
    } catch {
      reachable = false;
    }
    setChecking(false);
    await applyUrl(normalized);
    setValue(normalized);
    setStatus(
      reachable ? t("settings.connected") : t("settings.savedNoResponse"),
    );
  };

  const onReset = async () => {
    await applyUrl(null);
    setValue("");
    setStatus(t("settings.usingDefault"));
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      <Stack.Screen
        options={{
          title: t("settings.title"),
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
        }}
      />
      <Text style={[styles.kicker, { color: colors.primary }]}>
        {t("settings.connectionKicker")}
      </Text>
      <Text style={[styles.h1, { color: colors.foreground }]}>
        {t("settings.serverAddress")}
      </Text>
      <Text style={[styles.sub, { color: colors.mutedForeground }]}>
        {t("settings.serverAddressHint")}
      </Text>

      {!loaded ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
      ) : (
        <>
          <TextInput
            style={[
              styles.input,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.card,
              },
            ]}
            value={value}
            onChangeText={setValue}
            placeholder={DEFAULT_SERVER_URL}
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          <View style={styles.row}>
            <Pressable
              onPress={onReset}
              style={[styles.button, { borderColor: colors.border }]}
            >
              <Text style={[styles.buttonText, { color: colors.foreground }]}>
                {t("settings.useDefault")}
              </Text>
            </Pressable>
            <Pressable
              onPress={onSave}
              disabled={checking}
              style={[
                styles.button,
                styles.primary,
                { backgroundColor: colors.primary, borderColor: colors.primary },
              ]}
            >
              {checking ? (
                <ActivityIndicator color={colors.background} size="small" />
              ) : (
                <Text style={[styles.buttonText, { color: colors.background }]}>
                  {t("settings.saveConnect")}
                </Text>
              )}
            </Pressable>
          </View>

          {status ? (
            <View style={styles.statusRow}>
              <Feather
                name="info"
                size={14}
                color={colors.mutedForeground}
                style={{ marginTop: 2 }}
              />
              <Text style={[styles.status, { color: colors.mutedForeground }]}>
                {status}
              </Text>
            </View>
          ) : null}
        </>
      )}

      <Text style={[styles.kicker, { color: colors.primary, marginTop: 36 }]}>
        {t("settings.languageKicker")}
      </Text>
      <Text style={[styles.h1, { color: colors.foreground }]}>
        {t("settings.languageTitle")}
      </Text>
      <Text style={[styles.sub, { color: colors.mutedForeground }]}>
        {t("settings.languageHint")}
      </Text>

      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
        {t("settings.interfaceLanguage")}
      </Text>
      <View
        style={[
          styles.optionGroup,
          { borderColor: colors.border, backgroundColor: colors.card },
        ]}
      >
        {LANGUAGES.map((lang, i) => {
          const active = uiLang === lang.code;
          return (
            <Pressable
              key={lang.code}
              testID={`ui-language-${lang.code}`}
              onPress={() => onSelectUiLang(lang.code)}
              style={[
                styles.optionRow,
                i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : null,
              ]}
            >
              <Text
                style={[
                  styles.optionText,
                  { color: active ? colors.primary : colors.foreground },
                ]}
              >
                {lang.nativeName}
              </Text>
              {active ? (
                <Feather name="check" size={16} color={colors.primary} />
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
        {t("settings.replyLanguage")}
      </Text>
      <View
        style={[
          styles.optionGroup,
          { borderColor: colors.border, backgroundColor: colors.card },
        ]}
      >
        {(
          [
            { value: "match", label: t("settings.replyMatchUi") },
            { value: "auto", label: t("settings.replyAuto") },
            ...LANGUAGES.map((l) => ({ value: l.code, label: l.nativeName })),
          ] as { value: string; label: string }[]
        ).map((opt, i) => {
          const active = replyLang === opt.value;
          return (
            <Pressable
              key={opt.value}
              testID={`reply-language-${opt.value}`}
              onPress={() => onSelectReplyLang(opt.value)}
              style={[
                styles.optionRow,
                i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : null,
              ]}
            >
              <Text
                style={[
                  styles.optionText,
                  { color: active ? colors.primary : colors.foreground },
                ]}
              >
                {opt.label}
              </Text>
              {active ? (
                <Feather name="check" size={16} color={colors.primary} />
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {Platform.OS !== "web" ? (
        <>
          <Text style={[styles.kicker, { color: colors.primary, marginTop: 36 }]}>
            {t("settings.onDeviceKicker")}
          </Text>
          <Text style={[styles.h1, { color: colors.foreground }]}>
            {t("settings.offlineMode")}
          </Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            {t("settings.offlineHint", {
              model: MODEL_NAME,
              size: gb(MODEL_BYTES),
            })}
          </Text>

          <View style={[styles.offlineRow, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Text style={[styles.buttonText, { color: colors.foreground }]}>
              {t("settings.useOfflineMode")}
            </Text>
            <Switch
              value={offline}
              onValueChange={onToggleOffline}
              trackColor={{ true: colors.primary }}
            />
          </View>

          {modelStatus?.state === "ready" ? (
            <>
              <Text style={[styles.status, { color: colors.mutedForeground, marginTop: 12 }]}>
                {t("settings.modelInstalled", { size: gb(modelStatus.bytes) })}
              </Text>
              <Pressable
                onPress={onDeleteModel}
                style={[styles.button, { borderColor: colors.border, marginTop: 12 }]}
              >
                <Text style={[styles.buttonText, { color: colors.foreground }]}>
                  {t("settings.deleteModel")}
                </Text>
              </Pressable>
            </>
          ) : downloading ? (
            <>
              <View style={[styles.progressTrack, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View
                  style={[
                    styles.progressFill,
                    { backgroundColor: colors.primary, width: `${Math.round(progress * 100)}%` },
                  ]}
                />
              </View>
              <Text style={[styles.status, { color: colors.mutedForeground, marginTop: 8 }]}>
                {t("settings.downloading", { percent: Math.round(progress * 100) })}
              </Text>
              <Pressable
                onPress={onCancelDownload}
                style={[styles.button, { borderColor: colors.border, marginTop: 12 }]}
              >
                <Text style={[styles.buttonText, { color: colors.foreground }]}>
                  {t("settings.pauseDownload")}
                </Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              onPress={onDownload}
              style={[
                styles.button,
                { backgroundColor: colors.primary, borderColor: colors.primary, marginTop: 16 },
              ]}
            >
              <Text style={[styles.buttonText, { color: colors.background }]}>
                {modelStatus?.state === "partial"
                  ? t("settings.resumeDownload", { size: gb(modelStatus.bytes) })
                  : t("settings.downloadModel")}
              </Text>
            </Pressable>
          )}

          {offlineMsg ? (
            <View style={styles.statusRow}>
              <Feather
                name="info"
                size={14}
                color={colors.mutedForeground}
                style={{ marginTop: 2 }}
              />
              <Text style={[styles.status, { color: colors.mutedForeground }]}>
                {offlineMsg}
              </Text>
            </View>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  kicker: {
    fontFamily: "JetBrainsMono_500Medium",
    fontSize: 11,
    letterSpacing: 2,
    marginTop: 8,
  },
  h1: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 30,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  sub: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  input: {
    marginTop: 20,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
  },
  row: { flexDirection: "row", gap: 12, marginTop: 16 },
  button: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: {},
  buttonText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 15,
    letterSpacing: 0.5,
  },
  statusRow: { flexDirection: "row", gap: 8, marginTop: 16 },
  fieldLabel: {
    fontFamily: "JetBrainsMono_500Medium",
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginTop: 20,
    marginBottom: 8,
  },
  optionGroup: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden",
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  optionText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 15,
    letterSpacing: 0.5,
  },
  offlineRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 20,
  },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    overflow: "hidden",
    marginTop: 16,
  },
  progressFill: { height: "100%" },
  status: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 18,
  },
});
