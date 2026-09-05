import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import { Redirect } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";

import { useColors } from "@/hooks/useColors";
import { isRtlLanguage } from "@/lib/layout-direction";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

const TABS: {
  name: string;
  labelKey: string;
  feather: FeatherName;
  sf: string;
  sfSelected: string;
}[] = [
  { name: "index", labelKey: "tabs.personas", feather: "cpu", sf: "cpu", sfSelected: "cpu.fill" },
  { name: "feed", labelKey: "tabs.feed", feather: "radio", sf: "dot.radiowaves.left.and.right", sfSelected: "dot.radiowaves.left.and.right" },
  { name: "chat", labelKey: "tabs.chat", feather: "message-circle", sf: "bubble.left", sfSelected: "bubble.left.fill" },
  { name: "inquiry", labelKey: "tabs.inquiry", feather: "help-circle", sf: "questionmark.circle", sfSelected: "questionmark.circle.fill" },
];

function NativeTabLayout() {
  const { t, i18n } = useTranslation("mobile");
  const rtl = isRtlLanguage(i18n.resolvedLanguage ?? i18n.language);
  // Native tab bars already mirror under I18nManager. React Native Web does
  // not consistently reorder Expo Router tab items from document.dir alone.
  const tabs = rtl && Platform.OS === "web" ? [...TABS].reverse() : TABS;
  return (
    <NativeTabs>
      {tabs.map((tab) => (
        <NativeTabs.Trigger key={tab.name} name={tab.name}>
          <Icon sf={{ default: tab.sf as never, selected: tab.sfSelected as never }} />
          <Label>{t(tab.labelKey)}</Label>
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const { t, i18n } = useTranslation("mobile");
  const rtl = isRtlLanguage(i18n.resolvedLanguage ?? i18n.language);
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarLabelStyle: {
          fontFamily: "Rajdhani_600SemiBold",
          fontSize: 11,
          letterSpacing: 0.5,
          ...(rtl ? { fontFamily: undefined, letterSpacing: 0 } : {}),
        },
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.background,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={40}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.background },
              ]}
            />
          ),
      }}
    >
      {(rtl && isWeb ? [...TABS].reverse() : TABS).map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.labelKey),
            tabBarIcon: ({ color }) =>
              isIOS ? (
                <SymbolView name={tab.sf as never} tintColor={color} size={24} />
              ) : (
                <Feather name={tab.feather} size={22} color={color} />
              ),
          }}
        />
      ))}
    </Tabs>
  );
}

export default function TabLayout() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
