import { Feather } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
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

function gb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(2)} GB`;
}

export default function ServerSettingsScreen() {
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

  useEffect(() => {
    getServerUrlOverride().then((override) => {
      setValue(override ?? "");
      setLoaded(true);
    });
    if (Platform.OS !== "web") {
      getModelStatus().then(setModelStatus).catch(() => {});
    }
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
      setOfflineMsg("Model ready. You can now go fully offline.");
    } catch (err) {
      setOfflineMsg(err instanceof Error ? err.message : "Download failed — please retry.");
    } finally {
      setDownloading(false);
      refreshModel();
    }
  }, [refreshModel]);

  const onCancelDownload = useCallback(async () => {
    await cancelDownload();
    setDownloading(false);
    refreshModel();
  }, [refreshModel]);

  const onToggleOffline = useCallback(
    async (on: boolean) => {
      if (on && modelStatus?.state !== "ready") {
        setOfflineMsg("Download the on-device model first.");
        return;
      }
      setOffline(on);
      await setOfflineMode(on);
      if (!on) await releaseLlm().catch(() => {});
      setOfflineMsg(
        on
          ? "Offline mode active — everything now runs on this device."
          : "Back online — using the server.",
      );
    },
    [modelStatus],
  );

  const onDeleteModel = useCallback(async () => {
    await setOfflineMode(false);
    setOffline(false);
    await releaseLlm().catch(() => {});
    await deleteModel();
    refreshModel();
    setOfflineMsg("Model deleted.");
  }, [refreshModel]);

  const applyUrl = async (url: string | null) => {
    await setServerUrlOverride(url);
    setBaseUrl(url ?? DEFAULT_SERVER_URL);
  };

  const onSave = async () => {
    setStatus(null);
    const trimmed = value.trim();
    if (!trimmed) {
      await applyUrl(null);
      setStatus("Using the default cloud server.");
      return;
    }
    const normalized = normalizeServerUrl(trimmed);
    if (!normalized) {
      setStatus("That doesn't look like a valid address.");
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
      reachable
        ? "Connected. This address is now active."
        : "Saved — but the server did not respond. Double-check the address and that the desktop app is running.",
    );
  };

  const onReset = async () => {
    await applyUrl(null);
    setValue("");
    setStatus("Using the default cloud server.");
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      <Stack.Screen
        options={{
          title: "Server",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
        }}
      />
      <Text style={[styles.kicker, { color: colors.primary }]}>
        ENGRAM // CONNECTION
      </Text>
      <Text style={[styles.h1, { color: colors.foreground }]}>
        Server address
      </Text>
      <Text style={[styles.sub, { color: colors.mutedForeground }]}>
        Leave blank to use the default cloud server. To run fully offline,
        enter the address shown by the ENGRAM desktop app on your local
        network, e.g. http://192.168.1.20:3101
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
                Use default
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
                  Save & connect
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

      {Platform.OS !== "web" ? (
        <>
          <Text style={[styles.kicker, { color: colors.primary, marginTop: 36 }]}>
            ENGRAM // ON-DEVICE
          </Text>
          <Text style={[styles.h1, { color: colors.foreground }]}>
            Offline mode
          </Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            Run the engrams entirely on this phone — no server, no network. Uses
            a local model ({MODEL_NAME}, ~{gb(MODEL_BYTES)} one-time download)
            and keeps conversations in on-device storage. Chat, inquiries and
            transmissions work; media, simulations and the hub need the server.
          </Text>

          <View style={[styles.offlineRow, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Text style={[styles.buttonText, { color: colors.foreground }]}>
              Use offline mode
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
                Model installed ({gb(modelStatus.bytes)}).
              </Text>
              <Pressable
                onPress={onDeleteModel}
                style={[styles.button, { borderColor: colors.border, marginTop: 12 }]}
              >
                <Text style={[styles.buttonText, { color: colors.foreground }]}>
                  Delete model
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
                Downloading… {Math.round(progress * 100)}%
              </Text>
              <Pressable
                onPress={onCancelDownload}
                style={[styles.button, { borderColor: colors.border, marginTop: 12 }]}
              >
                <Text style={[styles.buttonText, { color: colors.foreground }]}>
                  Pause download
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
                  ? `Resume download (${gb(modelStatus.bytes)} so far)`
                  : "Download model"}
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
