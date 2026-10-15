import { useSignIn, useSSO } from "@clerk/expo";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { Link, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";

WebBrowser.maybeCompleteAuthSession();

export default function SignInScreen() {
  const { signIn, errors, fetchStatus } = useSignIn();
  const { startSSOFlow } = useSSO();
  const router = useRouter();
  const colors = useColors();
  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const busy = fetchStatus === "fetching";

  useEffect(() => {
    if (Platform.OS !== "android") return;
    void WebBrowser.warmUpAsync();
    return () => void WebBrowser.coolDownAsync();
  }, []);

  const finish = useCallback(async () => {
    await signIn.finalize({ navigate: () => router.replace("/") });
  }, [router, signIn]);

  const submit = useCallback(async () => {
    setMessage(null);
    const { error } = await signIn.password({ emailAddress, password });
    if (error) return;
    if (signIn.status === "complete") {
      await finish();
    } else {
      setMessage("This sign-in needs an additional verification step.");
    }
  }, [emailAddress, finish, password, signIn]);

  const google = useCallback(async () => {
    setMessage(null);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: "oauth_google",
        redirectUrl: AuthSession.makeRedirectUri(),
      });
      if (createdSessionId && setActive) {
        await setActive({
          session: createdSessionId,
          navigate: () => router.replace("/"),
        });
      }
    } catch {
      setMessage("Google sign-in could not be completed. Please try again.");
    }
  }, [router, startSSOFlow]);

  const error = errors?.fields.identifier?.message ?? errors?.fields.password?.message ?? message;
  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.mark, { color: colors.primary }]}>ENGRAM</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>Return to your signal.</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Sign in to your private persona workspace.
        </Text>
        <Text style={[styles.label, { color: colors.secondaryForeground }]}>EMAIL</Text>
        <TextInput style={[styles.input, { color: colors.foreground, borderColor: colors.input }]} value={emailAddress} onChangeText={setEmailAddress} autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="you@example.com" placeholderTextColor={colors.mutedForeground} />
        <Text style={[styles.label, { color: colors.secondaryForeground }]}>PASSWORD</Text>
        <TextInput style={[styles.input, { color: colors.foreground, borderColor: colors.input }]} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" placeholder="••••••••" placeholderTextColor={colors.mutedForeground} />
        {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
        <Pressable testID="sign-in-submit" disabled={busy || !emailAddress || !password} onPress={() => void submit()} style={[styles.primary, { backgroundColor: colors.primary }, (busy || !emailAddress || !password) && styles.disabled]}>
          {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>ENTER ENGRAM</Text>}
        </Pressable>
        <Pressable testID="google-sign-in" onPress={() => void google()} style={[styles.google, { borderColor: colors.border }]}>
          <Text style={[styles.googleText, { color: colors.foreground }]}>Continue with Google</Text>
        </Pressable>
        <Text style={[styles.footer, { color: colors.mutedForeground }]}>New to ENGRAM? <Link href="/(auth)/sign-up" style={{ color: colors.primary }}>Create an account</Link></Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1, justifyContent: "center", padding: 24 }, card: { borderWidth: 1, borderRadius: 16, padding: 24 }, mark: { fontFamily: "Rajdhani_700Bold", fontSize: 22, letterSpacing: 4 }, title: { fontFamily: "Rajdhani_700Bold", fontSize: 30, marginTop: 18 }, subtitle: { fontSize: 15, lineHeight: 22, marginTop: 6, marginBottom: 26 }, label: { fontFamily: "JetBrainsMono_700Bold", fontSize: 11, letterSpacing: 1, marginBottom: 7 }, input: { borderWidth: 1, borderRadius: 8, fontSize: 16, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 16 }, error: { fontSize: 13, marginTop: -6, marginBottom: 12 }, primary: { alignItems: "center", borderRadius: 8, minHeight: 48, justifyContent: "center", marginTop: 4 }, primaryText: { fontFamily: "Rajdhani_700Bold", fontSize: 16, letterSpacing: 1 }, google: { alignItems: "center", borderWidth: 1, borderRadius: 8, minHeight: 48, justifyContent: "center", marginTop: 12 }, googleText: { fontFamily: "Inter_600SemiBold", fontSize: 14 }, footer: { fontSize: 14, marginTop: 24, textAlign: "center" }, disabled: { opacity: 0.55 } });