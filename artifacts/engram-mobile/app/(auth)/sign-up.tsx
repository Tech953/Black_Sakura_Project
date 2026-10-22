import { useSignUp } from "@clerk/expo";
import { Link, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useColors } from "@/hooks/useColors";

export default function SignUpScreen() {
  const { signUp, errors, fetchStatus } = useSignUp();
  const router = useRouter();
  const colors = useColors();
  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const verifying = signUp.status === "missing_requirements" && signUp.unverifiedFields.includes("email_address") && signUp.missingFields.length === 0;
  const busy = fetchStatus === "fetching";

  const create = useCallback(async () => {
    setMessage(null);
    const { error } = await signUp.password({ emailAddress, password });
    if (!error) await signUp.verifications.sendEmailCode();
  }, [emailAddress, password, signUp]);
  const verify = useCallback(async () => {
    setMessage(null);
    await signUp.verifications.verifyEmailCode({ code });
    if (signUp.status === "complete") {
      await signUp.finalize({ navigate: () => router.replace("/") });
    } else setMessage("That verification code was not accepted.");
  }, [code, router, signUp]);
  const error = errors?.fields.code?.message ?? errors?.fields.emailAddress?.message ?? errors?.fields.password?.message ?? message;
  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.mark, { color: colors.primary }]}>ENGRAM</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>{verifying ? "Verify your signal." : "Begin a private workspace."}</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{verifying ? "Enter the code sent to your email." : "Your local and online history stay scoped to your account."}</Text>
        {verifying ? <><TextInput style={[styles.input, { color: colors.foreground, borderColor: colors.input }]} value={code} onChangeText={setCode} keyboardType="number-pad" placeholder="Verification code" placeholderTextColor={colors.mutedForeground} /><Pressable testID="sign-up-verify" disabled={busy || !code} onPress={() => void verify()} style={[styles.primary, { backgroundColor: colors.primary }, (busy || !code) && styles.disabled]}>{busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>VERIFY ACCOUNT</Text>}</Pressable><Pressable onPress={() => void signUp.verifications.sendEmailCode()}><Text style={[styles.resend, { color: colors.primary }]}>Send another code</Text></Pressable></> : <><Text style={[styles.label, { color: colors.secondaryForeground }]}>EMAIL</Text><TextInput style={[styles.input, { color: colors.foreground, borderColor: colors.input }]} value={emailAddress} onChangeText={setEmailAddress} autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="you@example.com" placeholderTextColor={colors.mutedForeground} /><Text style={[styles.label, { color: colors.secondaryForeground }]}>PASSWORD</Text><TextInput style={[styles.input, { color: colors.foreground, borderColor: colors.input }]} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" placeholder="Choose a password" placeholderTextColor={colors.mutedForeground} /><Pressable testID="sign-up-submit" disabled={busy || !emailAddress || !password} onPress={() => void create()} style={[styles.primary, { backgroundColor: colors.primary }, (busy || !emailAddress || !password) && styles.disabled]}>{busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>CREATE ACCOUNT</Text>}</Pressable><View nativeID="clerk-captcha" /></>}
        {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
        <Text style={[styles.footer, { color: colors.mutedForeground }]}>Already connected? <Link href="/(auth)/sign-in" style={{ color: colors.primary }}>Sign in</Link></Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1, justifyContent: "center", padding: 24 }, card: { borderWidth: 1, borderRadius: 16, padding: 24 }, mark: { fontFamily: "Rajdhani_700Bold", fontSize: 22, letterSpacing: 4 }, title: { fontFamily: "Rajdhani_700Bold", fontSize: 30, marginTop: 18 }, subtitle: { fontSize: 15, lineHeight: 22, marginTop: 6, marginBottom: 26 }, label: { fontFamily: "JetBrainsMono_700Bold", fontSize: 11, letterSpacing: 1, marginBottom: 7 }, input: { borderWidth: 1, borderRadius: 8, fontSize: 16, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 16 }, primary: { alignItems: "center", borderRadius: 8, minHeight: 48, justifyContent: "center", marginTop: 4 }, primaryText: { fontFamily: "Rajdhani_700Bold", fontSize: 16, letterSpacing: 1 }, error: { fontSize: 13, marginTop: 14 }, footer: { fontSize: 14, marginTop: 24, textAlign: "center" }, resend: { fontFamily: "Inter_600SemiBold", fontSize: 14, marginTop: 18, textAlign: "center" }, disabled: { opacity: 0.55 } });