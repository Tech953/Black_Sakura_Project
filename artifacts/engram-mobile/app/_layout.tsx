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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { EngramProvider } from "@/context/engram-context";
import { setBaseUrl, setLocalHandler } from "@workspace/api-client-react";
import { DEFAULT_SERVER_URL, resolveServerUrl } from "@/lib/server-url";
import { loadOfflineMode, subscribeOfflineMode } from "@/lib/offline/mode";
import { offlineHandler } from "@/lib/offline/handlers";

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
  // Cached query data belongs to the previous backend — drop it all.
  queryClient.clear();
});

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: "Back" }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="server-settings"
        options={{ presentation: "modal", title: "Server" }}
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
  useEffect(() => {
    serverUrlReady.finally(() => setServerReady(true));
  }, []);

  useEffect(() => {
    if ((fontsLoaded || fontError) && serverReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError, serverReady]);

  if ((!fontsLoaded && !fontError) || !serverReady) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
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
