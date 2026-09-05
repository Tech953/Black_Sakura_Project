import {
  beginLaunchCrashMonitoring,
  clearPreviousCrash,
  markLaunchReady,
  persistFatalCrash,
  updateLaunchBreadcrumb,
  type CrashReport,
} from "@/lib/crash-log";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
} from "@expo-google-fonts/jetbrains-mono";
import {
  Rajdhani_500Medium,
  Rajdhani_600SemiBold,
  Rajdhani_700Bold,
} from "@expo-google-fonts/rajdhani";
import { useFonts } from "expo-font";
import { reloadAppAsync } from "expo";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { AppState, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import "@/lib/i18n";
import { i18nReady } from "@/lib/i18n";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PreviousCrashScreen } from "@/components/PreviousCrashScreen";
import { EngramProvider } from "@/context/engram-context";
import { setBaseUrl, setLocalHandler } from "@workspace/api-client-react";
import { DEFAULT_SERVER_URL, resolveServerUrl } from "@/lib/server-url";
import {
  isOfflineMode,
  loadOfflineMode,
  subscribeOfflineMode,
} from "@/lib/offline/mode";
import { offlineHandler } from "@/lib/offline/handlers";
import { syncOfflineData } from "@/lib/offline/sync";
import { queryClient } from "@/lib/query-client";

// Apply the built-in default synchronously, then swap in any persisted
// override (e.g. the desktop app's LAN address) as soon as storage resolves —
// before fonts finish loading, so first queries already hit the right server.
setBaseUrl(DEFAULT_SERVER_URL);
const serverUrlReady = Promise.all([
  resolveServerUrl().then((url) => setBaseUrl(url)),
  // On-device offline mode: when active, all API calls are served locally.
  loadOfflineMode().then((on) => setLocalHandler(on ? offlineHandler : null)),
]).catch(() => {});

subscribeOfflineMode((on) => {
  setLocalHandler(on ? offlineHandler : null);
  // Entering offline mode changes the backing store immediately. When
  // reconnecting, the settings screen clears only after sync succeeds so local
  // history remains visible if the server is unavailable.
  if (on) queryClient.clear();
});

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  const { t } = useTranslation("mobile");
  return (
    <Stack screenOptions={{ headerBackTitle: t("nav.back") }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="server-settings"
        options={{ presentation: "modal", title: t("nav.server") }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Rajdhani_500Medium,
    Rajdhani_600SemiBold,
    Rajdhani_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
  });

  const [serverReady, setServerReady] = React.useState(false);
  const [languageReady, setLanguageReady] = React.useState(false);
  const [crashStateLoaded, setCrashStateLoaded] = React.useState(false);
  const [previousCrash, setPreviousCrash] =
    React.useState<CrashReport | null>(null);
  useEffect(() => {
    let active = true;
    void beginLaunchCrashMonitoring()
      .then((report) => {
        if (active) setPreviousCrash(report);
      })
      .finally(() => {
        if (active) setCrashStateLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    serverUrlReady.finally(() => setServerReady(true));
  }, []);

  useEffect(() => {
    let active = true;
    void i18nReady.then(async (restartRequired) => {
      if (!active) return;
      if (restartRequired && Platform.OS !== "web") {
        try {
          await reloadAppAsync();
          return;
        } catch (error) {
          console.error("Failed to restart after changing layout direction:", error);
        }
      }
      if (active) setLanguageReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      (fontsLoaded || fontError) &&
      crashStateLoaded &&
      languageReady &&
      (previousCrash || serverReady)
    ) {
      SplashScreen.hideAsync();
    }
  }, [
    crashStateLoaded,
    fontsLoaded,
    fontError,
    languageReady,
    previousCrash,
    serverReady,
  ]);

  useEffect(() => {
    if (
      !crashStateLoaded ||
      !languageReady ||
      previousCrash ||
      !serverReady ||
      (!fontsLoaded && !fontError)
    ) {
      return;
    }
    void updateLaunchBreadcrumb("ui-rendered");
    const timer = setTimeout(() => {
      void markLaunchReady();
    }, 1_000);
    return () => clearTimeout(timer);
  }, [
    crashStateLoaded,
    fontsLoaded,
    fontError,
    languageReady,
    previousCrash,
    serverReady,
  ]);

  useEffect(() => {
    if (!serverReady || previousCrash) return;
    const retryPendingHistory = () => {
      if (isOfflineMode()) return;
      void syncOfflineData()
        .then((result) => {
          if (result.syncedRows > 0 && !isOfflineMode()) queryClient.clear();
        })
        .catch(() => {
          // Pending rows remain local; the foreground/interval retry will reuse
          // the same stable IDs after connectivity returns.
        });
    };
    retryPendingHistory();
    const appStateSubscription = AppState.addEventListener(
      "change",
      (state) => {
        if (state === "active") retryPendingHistory();
      },
    );
    const retryTimer = setInterval(retryPendingHistory, 30_000);
    return () => {
      appStateSubscription.remove();
      clearInterval(retryTimer);
    };
  }, [previousCrash, serverReady]);

  if ((!fontsLoaded && !fontError) || !crashStateLoaded || !languageReady) return null;

  if (previousCrash) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <PreviousCrashScreen
          report={previousCrash}
          onContinue={() => {
            void clearPreviousCrash().finally(() => setPreviousCrash(null));
          }}
        />
      </SafeAreaProvider>
    );
  }

  if (!serverReady) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary
        onError={(error, componentStack) => {
          void persistFatalCrash(error, {
            source: "react-boundary",
            componentStack,
          });
        }}
      >
        <QueryClientProvider client={queryClient}>
          <EngramProvider>
            <GestureHandlerRootView>
              <KeyboardProvider>
                <StatusBar style="light" />
                <RootLayoutNav />
              </KeyboardProvider>
            </GestureHandlerRootView>
          </EngramProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
