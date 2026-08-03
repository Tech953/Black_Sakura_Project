import { Feather } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
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

export default function ServerSettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const [value, setValue] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    getServerUrlOverride().then((override) => {
      setValue(override ?? "");
      setLoaded(true);
    });
  }, []);

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
    <View style={[styles.container, { backgroundColor: colors.background }]}>
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
    </View>
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
  status: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 18,
  },
});
