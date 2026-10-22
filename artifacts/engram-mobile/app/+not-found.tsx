import { Link, Stack } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

export default function NotFoundScreen() {
  const { t } = useTranslation("mobile");
  const colors = useColors();

  return (
    <>
      <Stack.Screen options={{ title: t("notFound.title") }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {t("notFound.message")}
        </Text>

        <Link href="/" style={styles.link}>
          <Text style={[styles.linkText, { color: colors.primary }]}>
            {t("notFound.goHome")}
          </Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
  linkText: {
    fontSize: 14,
  },
});
