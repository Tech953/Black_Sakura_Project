import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { useTranslation } from "react-i18next";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";

import { useColors } from "@/hooks/useColors";

function NativeTabLayout() {
  const { t } = useTranslation("mobile");
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "cpu", selected: "cpu.fill" }} />
        <Label>{t("tabs.personas")}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="feed">
        <Icon sf={{ default: "dot.radiowaves.left.and.right", selected: "dot.radiowaves.left.and.right" }} />
        <Label>{t("tabs.feed")}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="chat">
        <Icon sf={{ default: "bubble.left", selected: "bubble.left.fill" }} />
        <Label>{t("tabs.chat")}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="inquiry">
        <Icon sf={{ default: "questionmark.circle", selected: "questionmark.circle.fill" }} />
        <Label>{t("tabs.inquiry")}</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

type FeatherName = React.ComponentProps<typeof Feather>["name"];

const TABS: {
  name: string;
  labelKey: string;
  feather: FeatherName;
  sf: string;
}[] = [
  { name: "index", labelKey: "tabs.personas", feather: "cpu", sf: "cpu" },
  { name: "feed", labelKey: "tabs.feed", feather: "radio", sf: "dot.radiowaves.left.and.right" },
  { name: "chat", labelKey: "tabs.chat", feather: "message-circle", sf: "bubble.left" },
  { name: "inquiry", labelKey: "tabs.inquiry", feather: "help-circle", sf: "questionmark.circle" },
];

function ClassicTabLayout() {
  const { t } = useTranslation("mobile");
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
      {TABS.map((tab) => (
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
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
