import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import React, { useEffect, useRef } from "react";
import { Alert, Linking, Platform } from "react-native";
import { useTranslation } from "react-i18next";
import { useAuth } from "@clerk/expo";

import { useEngram } from "@/context/engram-context";
import { isOfflineMode } from "@/lib/offline/mode";
import {
  useRegisterPushToken,
  useUnregisterPushToken,
} from "@workspace/api-client-react";

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

async function requestPushToken(
  showSettingsPrompt: () => void,
): Promise<PushTokenRegistration | null> {
  if (Platform.OS === "web" || isOfflineMode()) return null;

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
      return null;
    }
    permission = await Notifications.requestPermissionsAsync();
  }
  if (permission.status !== Notifications.PermissionStatus.GRANTED) {
    if (!permission.canAskAgain) showSettingsPrompt();
    return null;
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

function transmissionEngramId(
  response: Notifications.NotificationResponse,
): number | null {
  const value = response.notification.request.content.data?.engramId;
  const id = typeof value === "number" ? value : Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
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
  const register = useRegisterPushToken();
  const unregister = useUnregisterPushToken();
  const activeToken = useRef<PushTokenRegistration | null>(null);

  useEffect(() => {
    if (!accountReady || !isSignedIn || Platform.OS === "web" || isOfflineMode()) {
      return;
    }

    let active = true;
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

    void requestPushToken(showSettingsPrompt)
      .then((registration) => {
        if (!active || !registration) return;
        activeToken.current = registration;
        return register.mutateAsync({ data: registration });
      })
      .catch((error) => {
        console.warn("Unable to register for ENGRAM push notifications:", error);
      });

    return () => {
      active = false;
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
  }, [accountReady, isSignedIn]);

  useEffect(() => {
    if (Platform.OS === "web") return;

    const openTransmission = (
      response: Notifications.NotificationResponse,
    ) => {
      const engramId = transmissionEngramId(response);
      if (!engramId) return;
      setSelectedEngramId(engramId);
      router.replace("/(tabs)/feed");
    };

    const subscription =
      Notifications.addNotificationResponseReceivedListener(openTransmission);
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) openTransmission(response);
    });
    return () => subscription.remove();
  }, [router, setSelectedEngramId]);

  return null;
}