import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/expo";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState, PrimaryButton } from "@/components/ui";
import { useEngram } from "@/context/engram-context";
import { useColors } from "@/hooks/useColors";
import { resolveServerUrl } from "@/lib/server-url";
import {
  getGetMediaAssetQueryKey,
  getListMediaQueryKey,
  useDeleteMediaAsset,
  useGetMediaAsset,
  useListEngrams,
  useListMedia,
  useRetryMediaAsset,
  type MediaAsset,
  type WebmModality,
  needsWebmModalityChoice,
  normalizeMediaUploadMimeType,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getMediaUploadPercent } from "@/lib/media-upload-progress";

type PickedFile = {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
};

const statusTone: Record<MediaAsset["status"], "accent" | "primary" | "success" | "danger"> = {
  pending: "accent",
  processing: "primary",
  completed: "success",
  failed: "danger",
} as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function modalityIcon(modality: string): React.ComponentProps<typeof Feather>["name"] {
  if (modality === "image") return "image";
  if (modality === "audio") return "volume-2";
  if (modality === "video") return "video";
  return "file-text";
}

function MediaAssetCard({
  asset,
  engramName,
  serverUrl,
  authToken,
  initiallyExpanded = false,
}: {
  asset: MediaAsset;
  engramName: string;
  serverUrl: string;
  authToken: string | null;
  initiallyExpanded?: boolean;
}) {
  const { t } = useTranslation("media");
  const colors = useColors();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const retry = useRetryMediaAsset();
  const remove = useDeleteMediaAsset();
  const active = asset.status === "pending" || asset.status === "processing";
  const { data: detail, isLoading: detailLoading } = useGetMediaAsset(asset.id, {
    query: {
      enabled: expanded,
      queryKey: getGetMediaAssetQueryKey(asset.id),
      refetchInterval: expanded && active ? 4000 : false,
    },
  });
  const rawUri = `${serverUrl}/api/media/${asset.id}/raw`;
  const tone = statusTone[asset.status] ?? "muted";
  const toneColor =
    tone === "danger"
      ? colors.destructive
      : tone === "success"
        ? colors.success
        : tone === "accent"
          ? colors.accent
          : colors.primary;
  const recovered = asset.failureKind === "recovered";
  const failureTitle =
    recovered
      ? t("recoveredTitle")
      : asset.failureKind === "provider"
        ? t("providerFailureTitle")
        : asset.failureKind === "extraction"
          ? t("extractionFailureTitle")
          : t("perceptionFailed");

  const onRetry = () => {
    retry.mutate(
      { id: asset.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMediaQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMediaAssetQueryKey(asset.id) });
        },
            onError: () => Alert.alert(t("retryFailed", { defaultValue: "Retry failed" }), t("retryFailedBody", { defaultValue: "The media could not be re-queued." })),
      },
    );
  };

  const onDelete = () => {
    Alert.alert(t("delete"), t("deleteConfirm", { defaultValue: "Delete this media asset? Its observations are preserved." }), [
      { text: t("cancel", { defaultValue: "Cancel" }), style: "cancel" },
      {
        text: t("delete"),
        style: "destructive",
        onPress: () =>
          remove.mutate(
            { id: asset.id },
            {
              onSuccess: () =>
                queryClient.invalidateQueries({ queryKey: getListMediaQueryKey() }),
              onError: () => Alert.alert(t("deleteFailed", { defaultValue: "Delete failed" }), t("deleteFailedBody", { defaultValue: "The media asset could not be deleted." })),
            },
          ),
      },
    ]);
  };

  return (
    <View
      testID={`media-asset-${asset.id}`}
      style={[styles.assetCard, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <View style={styles.assetHeader}>
        <View style={[styles.assetIcon, { borderColor: colors.primary + "66" }]}>
          <Feather name={modalityIcon(asset.modality)} size={18} color={colors.primary} />
        </View>
        <View style={styles.assetMain}>
          <Text numberOfLines={1} style={[styles.assetName, { color: colors.foreground }]}>
            {asset.filename}
          </Text>
          <Text
            testID={`media-asset-mime-${asset.id}`}
            style={[styles.assetMeta, { color: colors.mutedForeground }]}
          >
            {asset.mimeType} · {engramName} · {formatBytes(asset.sizeBytes)} ·{" "}
            {formatTime(asset.createdAt)}
          </Text>
        </View>
        <View style={[styles.status, { borderColor: toneColor + "88" }]}>
          {active ? <View style={[styles.statusDot, { backgroundColor: toneColor }]} /> : null}
          <Text style={[styles.statusText, { color: toneColor }]}>
            {t(`status.${asset.status}`)}
          </Text>
        </View>
      </View>

      {asset.summary ? (
        <Text style={[styles.summary, { color: colors.foreground }]}>{asset.summary}</Text>
      ) : null}
      {asset.status === "failed" && (asset.error || asset.failureKind) ? (
        <View
          testID={`media-failure-notice-${asset.id}`}
          style={[styles.errorBox, { borderColor: colors.destructive + "66" }]}
        >
          <Text
            testID={`media-failure-category-${asset.id}`}
            style={[styles.errorText, { color: colors.destructive }]}
          >
            {failureTitle}
          </Text>
          {recovered ? (
            <>
              <Text style={[styles.errorSummary, { color: colors.destructive }]}>
                {t("recoveredBody")}
              </Text>
              <Text style={[styles.errorSummary, { color: colors.destructive }]}>
                {t("recoveredRetry")}
              </Text>
            </>
          ) : (
            <>
              <Text style={[styles.errorSummary, { color: colors.destructive }]}>
                {asset.failureKind === "provider"
                  ? t("providerFailureGuidance")
                  : asset.failureKind === "extraction"
                    ? t("extractionFailureGuidance")
                    : t("unknownFailureGuidance")}
              </Text>
              {asset.error ? (
                <Text style={[styles.errorSummary, { color: colors.destructive }]}>
                  {t("diagnosticLabel")}: {asset.error}
                </Text>
              ) : null}
            </>
          )}
          <Text style={[styles.errorSummary, { color: colors.destructive }]}>
            {asset.resultState === "partial"
              ? t("partialResultSaved", { count: asset.observationCount })
              : t("noResultSaved")}
          </Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        {asset.status === "failed" ? (
          <Pressable
            accessibilityLabel={t("retry")}
            testID={`media-asset-retry-${asset.id}`}
            disabled={retry.isPending}
            onPress={onRetry}
            style={[styles.action, { borderColor: colors.accent + "88" }]}
          >
            {retry.isPending ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Feather name="rotate-cw" size={14} color={colors.accent} />
            )}
            <Text style={[styles.actionText, { color: colors.accent }]}>{t("retry")}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityLabel={t("delete")}
          disabled={remove.isPending}
          onPress={onDelete}
          style={[styles.action, { borderColor: colors.destructive + "88" }]}
        >
          <Feather name="trash-2" size={14} color={colors.destructive} />
          <Text style={[styles.actionText, { color: colors.destructive }]}>
            {t("delete")}
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel={t("details")}
          onPress={() => setExpanded((value) => !value)}
          style={[styles.action, styles.detailsAction, { borderColor: colors.border }]}
        >
          <Feather
            name={expanded ? "chevron-down" : "chevron-right"}
            size={14}
            color={colors.mutedForeground}
          />
          <Text style={[styles.actionText, { color: colors.mutedForeground }]}>
            {t("details")}
          </Text>
        </Pressable>
      </View>

      {expanded ? (
        <View style={[styles.detail, { borderTopColor: colors.border }]}>
          {detailLoading ? <ActivityIndicator color={colors.primary} /> : null}
          {asset.modality === "image" ? (
            <Image
              source={{
                uri: rawUri,
                headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
              }}
              resizeMode="contain"
              style={styles.previewImage}
            />
          ) : (
            <Pressable
              onPress={async () => {
                try {
                  if (!FileSystem.cacheDirectory) throw new Error("Preview storage unavailable");
                  const local = await FileSystem.downloadAsync(
                    rawUri,
                    `${FileSystem.cacheDirectory}${asset.id}-${asset.filename.replace(/[^a-z0-9._-]/gi, "_")}`,
                    authToken
                      ? { headers: { Authorization: `Bearer ${authToken}` } }
                      : undefined,
                  );
                  if (await Sharing.isAvailableAsync()) {
                    await Sharing.shareAsync(local.uri);
                  } else {
                    await Linking.openURL(local.uri);
                  }
                } catch {
                  Alert.alert(t("openPreview", { defaultValue: "Open raw preview" }), t("previewFailed", { defaultValue: "The preview could not be opened." }));
                }
              }}
              style={[styles.previewLink, { borderColor: colors.border }]}
            >
              <Feather name="external-link" size={15} color={colors.primary} />
              <Text style={[styles.previewText, { color: colors.primary }]}>
                {t("openPreview", { defaultValue: "Open raw preview" })}
              </Text>
            </Pressable>
          )}
          {detail?.asset.transcript ? (
            <Text style={[styles.detailText, { color: colors.foreground }]}>
              <Text style={{ color: colors.mutedForeground }}>{t("transcript")}: </Text>
              {detail.asset.transcript}
            </Text>
          ) : null}
          {detail?.asset.commentary ? (
            <View style={[styles.commentary, { borderColor: colors.primary + "66" }]}>
              <Text style={[styles.detailLabel, { color: colors.primary }]}>
                {t("reacts", { name: engramName })}
              </Text>
              <Text style={[styles.detailText, { color: colors.foreground }]}>
                {detail.asset.commentary}
              </Text>
            </View>
          ) : null}
          <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>
            {t("observations")}
          </Text>
          {active ? (
            <Text style={[styles.detailText, { color: colors.mutedForeground }]}>
              {t("perceiving")}
            </Text>
          ) : detail?.observations.length ? (
            detail.observations.map((observation) => (
              <View key={observation.id} style={[styles.observation, { borderColor: colors.border }]}>
                <Text style={[styles.detailText, { color: colors.foreground }]}>
                  {observation.content}
                </Text>
                <Text style={[styles.assetMeta, { color: colors.mutedForeground }]}>
                  {observation.provenance} · {Math.round(observation.confidence * 100)}%
                </Text>
              </View>
            ))
          ) : (
            <Text style={[styles.detailText, { color: colors.mutedForeground }]}>
              {t("noObservations")}
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

export default function MediaScreen() {
  const { t } = useTranslation("media");
  const { t: mobileT } = useTranslation("mobile");
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ asset?: string | string[] }>();
  const listRef = useRef<FlatList<MediaAsset>>(null);
  const { getToken } = useAuth();
  const { selectedEngramId } = useEngram();
  const queryClient = useQueryClient();
  const engramsQuery = useListEngrams();
  const [selectedId, setSelectedId] = useState<number | null>(selectedEngramId);
  const [file, setFile] = useState<PickedFile | null>(null);
  const [webmModality, setWebmModality] = useState<WebmModality | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [canCancelUpload, setCanCancelUpload] = useState(false);
  const activeUploadRef = useRef<XMLHttpRequest | null>(null);
  const [serverUrl, setServerUrl] = useState("");
  const [authToken, setAuthToken] = useState<string | null>(null);
  const needsWebmChoice = file
    ? needsWebmModalityChoice(file.name, file.mimeType)
    : false;
  const focusedAssetId = useMemo(() => {
    const raw = Array.isArray(params.asset) ? params.asset[0] : params.asset;
    const id = Number(raw);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }, [params.asset]);
  const mediaQuery = useListMedia(undefined, {
    query: {
      queryKey: getListMediaQueryKey(),
      refetchInterval: (query) =>
        query.state.data?.some((asset) => asset.status === "pending" || asset.status === "processing")
          ? 4000
          : false,
    },
  });
  useEffect(() => {
    if (focusedAssetId === null || !mediaQuery.data) return;
    const index = mediaQuery.data.findIndex((asset) => asset.id === focusedAssetId);
    if (index < 0) return;
    const timer = setTimeout(() => {
      listRef.current?.scrollToIndex({ index, animated: false });
    }, 0);
    return () => clearTimeout(timer);
  }, [focusedAssetId, mediaQuery.data]);
  const engramNames = useMemo(
    () => new Map((engramsQuery.data ?? []).map((engram) => [engram.id, engram.name])),
    [engramsQuery.data],
  );
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  useEffect(() => {
    let active = true;
    void resolveServerUrl().then((url) => {
      if (active) setServerUrl(url);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void getToken().then((token) => {
      if (active) setAuthToken(token);
    });
    return () => {
      active = false;
    };
  }, [getToken]);

  useEffect(
    () => () => {
      activeUploadRef.current?.abort();
    },
    [],
  );

  const pickFile = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["text/*", "image/*", "audio/*", "video/*", "application/json"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets.length) return;
    const picked = result.assets[0];
    setFile({
      uri: picked.uri,
      name: picked.name,
      mimeType: normalizeMediaUploadMimeType(picked.name, picked.mimeType),
      size: picked.size,
    });
    setWebmModality(null);
  }, []);

  const upload = useCallback(async () => {
    if (
      !file ||
      selectedId == null ||
      (needsWebmModalityChoice(file.name, file.mimeType) && !webmModality)
    ) {
      return;
    }
    setUploading(true);
    setUploadProgress(null);
    try {
      const serverUrl = await resolveServerUrl();
      const token = await getToken();
      const body = new FormData();
      body.append("engramId", String(selectedId));
      body.append("file", {
        uri: file.uri,
        name: file.name,
        type: normalizeMediaUploadMimeType(
          file.name,
          file.mimeType,
          webmModality,
        ),
      } as unknown as Blob);
      const response = await new Promise<XMLHttpRequest>((resolve, reject) => {
        const request = new XMLHttpRequest();
        activeUploadRef.current = request;
        request.open("POST", `${serverUrl}/api/media`);
        if (token) request.setRequestHeader("Authorization", `Bearer ${token}`);
        request.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            setUploadProgress(getMediaUploadPercent(event.loaded, event.total));
          }
        };
        request.upload.onload = () => {
          setUploadProgress(100);
          setCanCancelUpload(false);
        };
        request.onload = () => {
          setUploadProgress(100);
          resolve(request);
        };
        request.onerror = () =>
          reject(new Error(t("unknownError", { defaultValue: "Unknown error" })));
        request.onabort = () => {
          const error = new Error("Upload cancelled");
          error.name = "AbortError";
          reject(error);
        };
        setCanCancelUpload(true);
        request.send(body);
      });
      if (response.status < 200 || response.status >= 300) {
        const payload = (() => {
          try {
            return JSON.parse(response.responseText) as { error?: string };
          } catch {
            return null;
          }
        })();
        if (response.status === 413) {
          throw new Error(
            t("fileTooLarge", {
              defaultValue: "This file is too large to upload.",
            }),
          );
        }
        if (response.status === 415) {
          const serverMessage = payload?.error ?? "";
          const message = /unsupported media type/i.test(serverMessage)
            ? t("unsupportedFileType", {
                defaultValue:
                  "This file type is not supported. Choose a text, image, audio, or video file.",
              })
            : t("fileTypeMismatch", {
                defaultValue:
                  "The file contents, MIME type, or filename extension do not agree. Choose the original file.",
              });
          throw new Error(
            message,
          );
        }
        throw new Error(payload?.error ?? t("uploadFailed", { defaultValue: "Upload failed" }));
      }
      setFile(null);
      setWebmModality(null);
      await queryClient.invalidateQueries({ queryKey: getListMediaQueryKey() });
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        Alert.alert(
          t("uploadFailed", { defaultValue: "Upload failed" }),
          error instanceof Error ? error.message : t("unknownError", { defaultValue: "Unknown error" }),
        );
      }
    } finally {
      activeUploadRef.current = null;
      setCanCancelUpload(false);
      setUploading(false);
      setUploadProgress(null);
    }
  }, [file, getToken, queryClient, selectedId, t, webmModality]);

  const cancelUpload = useCallback(() => {
    activeUploadRef.current?.abort();
  }, []);

  if (mediaQuery.isError || engramsQuery.isError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <EmptyState
          icon={<Feather name="wifi-off" size={28} color={colors.mutedForeground} />}
          title={t("connectionLost", { defaultValue: "Media unavailable" })}
          subtitle={t("connectionLostBody", { defaultValue: "Could not reach the ENGRAM core." })}
        />
        <PrimaryButton
          label={t("retry")}
          tone="outline"
          onPress={() => {
            void mediaQuery.refetch();
            void engramsQuery.refetch();
          }}
          style={styles.retryButton}
        />
      </View>
    );
  }

  return (
    <FlatList
      ref={listRef}
      data={mediaQuery.data ?? []}
      keyExtractor={(asset) => String(asset.id)}
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{
        paddingHorizontal: 20,
        paddingTop: topPad + 16,
        paddingBottom: insets.bottom + 110,
      }}
      refreshControl={
        <RefreshControl
          refreshing={mediaQuery.isRefetching}
          onRefresh={() => void mediaQuery.refetch()}
          tintColor={colors.primary}
        />
      }
      onScrollToIndexFailed={({ index, averageItemLength }) => {
        const approximateOffset = Math.max(1, averageItemLength) * index;
        listRef.current?.scrollToOffset({ offset: approximateOffset, animated: false });
        setTimeout(() => {
          listRef.current?.scrollToIndex({
            index,
            animated: false,
            viewPosition: 0.15,
          });
        }, 100);
      }}
      ListHeaderComponent={
        <View>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.kicker, { color: colors.primary }]}>MEDIA PERCEPTION</Text>
              <Text style={[styles.title, { color: colors.foreground }]}>{t("title")}</Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                {t("subtitle")}
              </Text>
            </View>
            <Pressable onPress={() => router.push("/(tabs)")} accessibilityLabel={mobileT("tabs.personas")}>
              <Feather name="cpu" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <View style={[styles.rail, { borderColor: colors.primary + "44", backgroundColor: colors.card }]}>
            <Text style={[styles.railTitle, { color: colors.primary }]}>
              {t("perceptionRailTitle")}
            </Text>
            <Text style={[styles.railBody, { color: colors.mutedForeground }]}>
              {t("perceptionRailBody1")} {t("perceptionRailObserved")} {t("perceptionRailBody2")} {t("perceptionRailSource")}.
            </Text>
          </View>
          <View style={[styles.uploadCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              {t("shareMedia")}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.engramChips}>
              {(engramsQuery.data ?? []).map((engram) => {
                const selected = selectedId === engram.id;
                return (
                  <Pressable
                    key={engram.id}
                    testID={`media-engram-${engram.id}`}
                    onPress={() => setSelectedId(engram.id)}
                    style={[
                      styles.engramChip,
                      {
                        borderColor: selected ? colors.primary : colors.border,
                        backgroundColor: selected ? colors.primary + "20" : colors.background,
                      },
                    ]}
                  >
                    <Text style={[styles.engramChipText, { color: selected ? colors.primary : colors.mutedForeground }]}>
                      {engram.symbol} {engram.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              testID="media-file-picker"
              accessibilityLabel={t("selectEngram")}
              onPress={() => void pickFile()}
              style={[styles.filePicker, { borderColor: colors.border }]}
            >
              <Feather name="paperclip" size={17} color={colors.primary} />
              <Text
                numberOfLines={1}
                testID="media-selected-filename"
                style={[styles.fileName, { color: colors.foreground }]}
              >
                {file?.name ?? t("selectEngram")}
              </Text>
            </Pressable>
            {file ? (
              <Text
                testID="media-selected-mime"
                style={[styles.fileMeta, { color: colors.mutedForeground }]}
              >
                {normalizeMediaUploadMimeType(
                  file.name,
                  file.mimeType,
                  webmModality,
                )}{" "}
                · {formatBytes(file.size ?? 0)}
              </Text>
            ) : null}
            {file && needsWebmChoice ? (
              <View style={styles.webmChoice} testID="media-webm-modality-choice">
                <Text style={[styles.webmChoicePrompt, { color: colors.mutedForeground }]}>
                  {t("webmModalityPrompt")}
                </Text>
                <View style={styles.webmChoiceOptions}>
                  {(["audio", "video"] as const).map((modality) => {
                    const selected = webmModality === modality;
                    return (
                      <Pressable
                        key={modality}
                        testID={`media-webm-modality-${modality}`}
                        accessibilityRole="button"
                        accessibilityLabel={t(
                          modality === "audio" ? "webmAudioOption" : "webmVideoOption",
                        )}
                        accessibilityState={{ selected }}
                        onPress={() => setWebmModality(modality)}
                        style={[
                          styles.webmChoiceButton,
                          {
                            borderColor: selected ? colors.primary : colors.border,
                            backgroundColor: selected
                              ? colors.primary + "20"
                              : colors.background,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.webmChoiceText,
                            { color: selected ? colors.primary : colors.foreground },
                          ]}
                        >
                          {t(modality === "audio" ? "webmAudioOption" : "webmVideoOption")}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
            <PrimaryButton
              testID="media-upload"
              label={t("perceive")}
              loading={uploading}
              disabled={
                !file ||
                selectedId == null ||
                (needsWebmChoice && !webmModality)
              }
              onPress={() => void upload()}
              style={{ marginTop: 12 }}
            />
            {uploading ? (
              <View testID="media-upload-progress" style={styles.uploadProgress}>
                <Text
                  testID="media-upload-progress-label"
                  style={[styles.fileMeta, { color: colors.mutedForeground }]}
                >
                  {uploadProgress === null
                    ? t("uploadingFile", { defaultValue: "Uploading file…" })
                    : t("uploadProgress", {
                        percent: uploadProgress,
                        defaultValue: "Uploading file: {{percent}}%",
                      })}
                </Text>
                {uploadProgress === null ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <View
                    accessibilityRole="progressbar"
                    accessibilityLabel={t("uploadProgress", {
                      percent: uploadProgress,
                      defaultValue: "Uploading file: {{percent}}%",
                    })}
                    accessibilityValue={{ min: 0, max: 100, now: uploadProgress }}
                    testID="media-upload-progressbar"
                    style={[styles.uploadProgressTrack, { backgroundColor: colors.border }]}
                  >
                    <View
                      style={[
                        styles.uploadProgressFill,
                        {
                          width: `${uploadProgress}%`,
                          backgroundColor: colors.primary,
                        },
                      ]}
                    />
                  </View>
                )}
                {canCancelUpload ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("cancelUpload", {
                      defaultValue: "Cancel upload",
                    })}
                    testID="media-upload-cancel"
                    onPress={cancelUpload}
                    style={[
                      styles.uploadCancel,
                      { borderColor: colors.destructive + "88" },
                    ]}
                  >
                    <Feather name="x-circle" size={14} color={colors.destructive} />
                    <Text style={[styles.actionText, { color: colors.destructive }]}>
                      {t("cancelUpload", { defaultValue: "Cancel upload" })}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            {t("assetsCount", { count: mediaQuery.data?.length ?? 0 })}
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <MediaAssetCard
          asset={item}
          engramName={item.engramId == null ? t("pyriChat") : engramNames.get(item.engramId) ?? t("engramGeneric")}
          serverUrl={serverUrl}
          authToken={authToken}
          initiallyExpanded={item.id === focusedAssetId}
        />
      )}
      ListEmptyComponent={
        mediaQuery.isLoading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : (
          <EmptyState
            icon={<Feather name="eye" size={28} color={colors.mutedForeground} />}
            title={t("emptyTitle")}
            subtitle={t("emptyBody")}
          />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  kicker: { fontFamily: "JetBrainsMono_500Medium", fontSize: 11, letterSpacing: 2 },
  title: { fontFamily: "Rajdhani_700Bold", fontSize: 32, marginTop: 3 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19, marginTop: 3 },
  rail: { borderWidth: 1, padding: 13, marginTop: 16, gap: 5 },
  railTitle: { fontFamily: "JetBrainsMono_500Medium", fontSize: 10, letterSpacing: 1.2 },
  railBody: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  uploadCard: { borderWidth: 1, borderRadius: 8, padding: 14, marginTop: 14, marginBottom: 18 },
  sectionLabel: { fontFamily: "JetBrainsMono_500Medium", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 10 },
  engramChips: { gap: 8, paddingBottom: 12 },
  engramChip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 11, paddingVertical: 8 },
  engramChipText: { fontFamily: "Rajdhani_600SemiBold", fontSize: 14 },
  filePicker: { flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1, borderRadius: 6, padding: 12 },
  fileName: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 13 },
  fileMeta: { fontFamily: "JetBrainsMono_400Regular", fontSize: 10, marginTop: 7 },
  uploadProgress: { marginTop: 10, gap: 7 },
  uploadProgressTrack: { height: 5, borderRadius: 3, overflow: "hidden" },
  uploadProgressFill: { height: "100%", borderRadius: 3 },
  uploadCancel: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  webmChoice: { marginTop: 12, gap: 8 },
  webmChoicePrompt: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  webmChoiceOptions: { flexDirection: "row", gap: 8 },
  webmChoiceButton: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  webmChoiceText: { fontFamily: "JetBrainsMono_500Medium", fontSize: 11, textTransform: "uppercase" },
  retryButton: { marginTop: 20, minWidth: 130 },
  assetCard: { borderWidth: 1, borderRadius: 8, padding: 14, marginBottom: 12 },
  assetHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  assetIcon: { width: 38, height: 38, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  assetMain: { flex: 1 },
  assetName: { fontFamily: "Rajdhani_600SemiBold", fontSize: 17 },
  assetMeta: { fontFamily: "JetBrainsMono_400Regular", fontSize: 10, marginTop: 3 },
  status: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 4 },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontFamily: "JetBrainsMono_500Medium", fontSize: 9, textTransform: "uppercase" },
  summary: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19, marginTop: 12 },
  errorBox: { borderWidth: 1, padding: 9, marginTop: 10 },
  errorText: { fontFamily: "JetBrainsMono_400Regular", fontSize: 11, lineHeight: 16 },
  errorSummary: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18, marginTop: 7 },
  actions: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 12 },
  action: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 5 },
  detailsAction: { marginLeft: "auto" },
  actionText: { fontFamily: "JetBrainsMono_500Medium", fontSize: 10, textTransform: "uppercase" },
  detail: { borderTopWidth: 1, marginTop: 12, paddingTop: 12, gap: 10 },
  previewImage: { width: "100%", height: 190, backgroundColor: "#00000033" },
  previewLink: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, padding: 11 },
  previewText: { fontFamily: "JetBrainsMono_500Medium", fontSize: 11 },
  commentary: { borderWidth: 1, padding: 10, gap: 6 },
  detailLabel: { fontFamily: "JetBrainsMono_500Medium", fontSize: 10, letterSpacing: 1, textTransform: "uppercase" },
  detailText: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  observation: { borderWidth: 1, padding: 9, gap: 5 },
});