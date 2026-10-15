import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import React, { useEffect, useRef } from "react";
import { Alert, AppState, Linking, Platform } from "react-native";
import { useTranslation } from "react-i18next";
import { useAuth } from "@clerk/expo";

import { useEngram } from "@/context/engram-context";
import { useOfflineMode } from "@/lib/offline/mode";
import {
  hydratePushRegistrationStatus,
  setPushRegistrationStatus,
} from "@/lib/push-registration";
import {
  useRegisterPushToken,
  useUnregisterPushToken,
} from "@workspace/api-client-react";
import {
  handleLastNotificationResponse,
  handleNotificationResponse,
  MOBILE_FEED_ROUTE,
} from "@/lib/push-notification-routing";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

type PushTokenRegistration = {
  token: string;
  platform: "ios" | "android";
};

type PushTokenRequestResult =
  | PushTokenRegistration
  | { kind: "permission-denied"; canAskAgain: boolean }
  | null;

async function requestPushToken(
  showSettingsPrompt: () => void,
): Promise<PushTokenRequestResult> {
  if (Platform.OS === "web") return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("engram-outreach", {
      name: "ENGRAM outreach",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      sound: "default",
    });
  }

  let permission = await Notifications.getPermissionsAsync();
  if (permission.status !== Notifications.PermissionStatus.GRANTED) {
    if (permission.status === Notifications.PermissionStatus.DENIED && !permission.canAskAgain) {
      showSettingsPrompt();
      return {
        kind: "permission-denied",
        canAskAgain: permission.canAskAgain,
      };
    }
    permission = await Notifications.requestPermissionsAsync();
  }
  if (permission.status !== Notifications.PermissionStatus.GRANTED) {
    if (!permission.canAskAgain) showSettingsPrompt();
    return {
      kind: "permission-denied",
      canAskAgain: permission.canAskAgain,
    };
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;
  const expoToken = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  return {
    token: expoToken.data,
    platform: Platform.OS === "ios" ? "ios" : "android",
  };
}

export function MobilePushNotifications({
  accountReady,
}: {
  accountReady: boolean;
}) {
  const { t } = useTranslation("mobile");
  const { isSignedIn } = useAuth();
  const { setSelectedEngramId } = useEngram();
  const router = useRouter();
  const offline = useOfflineMode();
  const register = useRegisterPushToken();
  const unregister = useUnregisterPushToken();
  const activeToken = useRef<PushTokenRegistration | null>(null);

  useEffect(() => {
    if (Platform.OS === "web") return;
    if (offline) {
      setPushRegistrationStatus("offline");
      return;
    }
    if (!accountReady || !isSignedIn) {
      setPushRegistrationStatus("unknown");
      return;
    }

    let active = true;
    let attempting = false;
    const showSettingsPrompt = () => {
      Alert.alert(
        t("notifications.permissionDeniedTitle"),
        t("notifications.permissionDeniedBody"),
        [
          { text: t("notifications.notNow"), style: "cancel" },
          {
            text: t("notifications.openSettings"),
            onPress: () => {
              void Linking.openSettings();
            },
          },
        ],
      );
    };

    const attemptRegistration = async () => {
      if (!active || attempting) return;
      attempting = true;
      setPushRegistrationStatus("registering");
      try {
        const registration = await requestPushToken(showSettingsPrompt);
        if (!active) return;
        if (!registration) {
          setPushRegistrationStatus("offline");
          return;
        }
        if ("kind" in registration) {
          setPushRegistrationStatus("permission-denied", {
            canAskAgain: registration.canAskAgain,
          });
          return;
        }
        activeToken.current = registration;
        await register.mutateAsync({ data: registration });
        if (active) setPushRegistrationStatus("registered");
      } catch (error) {
        if (active) setPushRegistrationStatus("failed");
        console.warn("Unable to register for ENGRAM push notifications:", error);
      } finally {
        attempting = false;
      }
    };

    void hydratePushRegistrationStatus().then(attemptRegistration);
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void attemptRegistration();
    });

    return () => {
      active = false;
      appStateSubscription.remove();
      const registration = activeToken.current;
      activeToken.current = null;
      if (registration) {
        void unregister
          .mutateAsync({ data: registration })
          .catch(() => {
            // A sign-out or server change may already have removed auth.
          });
      }
    };
  }, [accountReady, isSignedIn, offline]);

  useEffect(() => {
    if (Platform.OS === "web") return;

    const handlers = {
      selectEngram: setSelectedEngramId,
      replace: (route: typeof MOBILE_FEED_ROUTE) => router.replace(route),
    };

    const subscription =
      Notifications.addNotificationResponseReceivedListener((response) =>
        handleNotificationResponse(response, handlers),
      );
    void handleLastNotificationResponse(
      Notifications.getLastNotificationResponseAsync,
      handlers,
    );
    return () => subscription.remove();
  }, [router, setSelectedEngramId]);

  return null;
}