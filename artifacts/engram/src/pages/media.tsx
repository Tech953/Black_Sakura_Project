import { useMemo, useRef, useState } from "react";
import {
  useListMedia,
  useGetMediaAsset,
  useRetryMediaAsset,
  useDeleteMediaAsset,
  useListEngrams,
  getListMediaQueryKey,
  getGetMediaAssetQueryKey,
  type MediaAsset,
  type MediaObservationEntry,
  type Engram,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ScanEye,
  FileText,
  Image as ImageIcon,
  AudioLines,
  Video,
  Upload,
  ChevronDown,
  ChevronRight,
  RotateCw,
  Trash2,
  Eye,
  AlertTriangle,
  Loader2,
  MessageSquareQuote,
  ScrollText,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

const STATUS_META: Record<
  string,
  { cls: string; pulse?: boolean }
> = {
  pending: { cls: "border-amber-500/40 text-amber-400" },
  processing: {
    cls: "border-sky-500/40 text-sky-400",
    pulse: true,
  },
  completed: { cls: "border-emerald-500/40 text-emerald-400" },
  failed: { cls: "border-rose-500/40 text-rose-400" },
};

function statusLabel(t: TFunction, status: string): string {
  return STATUS_META[status] ? t(`status.${status}`) : t("status.pending");
}

const MODALITY_ICON: Record<string, typeof FileText> = {
  text: FileText,
  image: ImageIcon,
  audio: AudioLines,
  video: Video,
};

function relativeTime(t: TFunction, iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return t("time.justNow");
  const min = Math.round(sec / 60);
  if (min < 60) return t("time.minutesAgo", { count: min });
  const hr = Math.round(min / 60);
  if (hr < 24) return t("time.hoursAgo", { count: hr });
  return t("time.daysAgo", { count: Math.round(hr / 24) });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Media() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation("media");
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: engrams } = useListEngrams();
  const [selectedEngramId, setSelectedEngramId] = useState<number | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data: assets, isLoading } = useListMedia(undefined, {
    query: {
      queryKey: getListMediaQueryKey(),
    },
  });

  const hasActive = (assets ?? []).some(
    (a) => a.status === "pending" || a.status === "processing",
  );

  // Re-fetch the list with the polling interval while any job is in flight.
  useListMedia(undefined, {
    query: {
      queryKey: getListMediaQueryKey(),
      refetchInterval: hasActive ? 4000 : false,
    },
  });

  const engramById = useMemo(() => {
    const m = new Map<number, Engram>();
    for (const e of engrams ?? []) m.set(e.id, e);
    return m;
  }, [engrams]);

  const ordered = useMemo(
    () =>
      [...(assets ?? [])].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [assets],
  );

  async function handleUpload() {
    if (!file || selectedEngramId === "") return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("engramId", String(selectedEngramId));
      form.append("file", file);
      const res = await fetch("/api/media", { method: "POST", body: form });
      if (!res.ok) {
        let msg = t("uploadFailedStatus", { status: res.status });
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) msg = body.error;
        } catch {
          /* ignore parse errors */
        }
        throw new Error(msg);
      }
      toast({ title: t("toastUploadedTitle"), description: t("toastUploadedDescription") });
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: getListMediaQueryKey() });
    } catch (e) {
      toast({
        title: t("toastUploadFailedTitle"),
        description: e instanceof Error ? e.message : t("unknownError"),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-bold tracking-widest text-primary flex items-center gap-3 glow-text">
            <ScanEye className="w-7 h-7" /> {t("title")}
          </h2>
          <p className="text-sm font-mono text-muted-foreground mt-1">
            {t("subtitle")}
          </p>
        </div>
        <Badge
          variant="outline"
          className="font-mono text-[10px] uppercase tracking-wider border-primary/40 text-primary gap-1.5"
        >
          <ScanEye className="w-3 h-3" /> {t("assetsCount", { count: ordered.length })}
        </Badge>
      </div>

      <div className="bg-primary/[0.03] border border-primary/20 p-4 font-mono text-xs text-muted-foreground space-y-1">
        <p className="text-primary/80 flex items-center gap-1.5">
          <Eye className="w-3.5 h-3.5" /> {t("perceptionRailTitle")}
        </p>
        <p>
          {t("perceptionRailBody1")}{" "}
          <span className="text-primary/90">{t("perceptionRailObserved")}</span>{t("perceptionRailBody2")}{" "}
          <span className="text-primary/90">{t("perceptionRailSource")}</span>{t("perceptionRailBody3")}
        </p>
      </div>

      {/* Upload */}
      <Card className="bg-card/40 border-primary/25 backdrop-blur-sm">
        <CardContent className="p-4 space-y-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70 flex items-center gap-1.5">
            <Upload className="w-3 h-3" /> {t("shareMedia")}
          </p>
          <div className="flex flex-col md:flex-row gap-3 md:items-center">
            <select
              value={selectedEngramId}
              onChange={(e) =>
                setSelectedEngramId(e.target.value === "" ? "" : Number(e.target.value))
              }
              className="bg-background border border-border/60 text-sm font-mono px-3 py-2 text-foreground focus:border-primary/60 outline-none"
              data-testid="select-engram"
            >
              <option value="">{t("selectEngram")}</option>
              {(engrams ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.symbol ? `${e.symbol} ` : ""}
                  {e.name}
                </option>
              ))}
            </select>

            <input
              ref={fileRef}
              type="file"
              accept="text/plain,text/markdown,text/csv,application/json,image/*,audio/*,video/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm font-mono text-muted-foreground file:mr-3 file:border file:border-primary/40 file:bg-primary/10 file:text-primary file:px-3 file:py-1.5 file:text-xs file:uppercase file:tracking-wider file:font-mono hover:file:bg-primary/20 file:cursor-pointer"
              data-testid="input-file"
            />

            <Button
              onClick={handleUpload}
              disabled={uploading || !file || selectedEngramId === ""}
              className="font-mono text-[10px] uppercase tracking-wider h-9 md:ml-auto"
              data-testid="button-upload"
            >
              {uploading ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5 mr-1.5" />
              )}
              {t("perceive")}
            </Button>
          </div>
          {file && (
            <p className="font-mono text-[10px] text-muted-foreground/60">
              {file.name} · {formatBytes(file.size)}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Asset list */}
      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 bg-primary/5" />
          ))
        ) : !ordered.length ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground font-mono text-center">
            <ScanEye className="w-8 h-8 mb-4 opacity-30" />
            <p className="text-xs uppercase tracking-widest">{t("emptyTitle")}</p>
            <p className="text-[10px] mt-2 opacity-60 max-w-sm">
              {t("emptyBody")}
            </p>
          </div>
        ) : (
          ordered.map((asset) => (
            <MediaCard
              key={asset.id}
              asset={asset}
              engram={asset.engramId == null ? undefined : engramById.get(asset.engramId)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function MediaCard({ asset, engram }: { asset: MediaAsset; engram?: Engram }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation("media");
  const [expanded, setExpanded] = useState(false);

  const retry = useRetryMediaAsset();
  const remove = useDeleteMediaAsset();

  const status = STATUS_META[asset.status] ?? STATUS_META.pending;
  const Icon = MODALITY_ICON[asset.modality] ?? FileText;
  const active = asset.status === "pending" || asset.status === "processing";

  const { data: detail } = useGetMediaAsset(asset.id, {
    query: {
      queryKey: getGetMediaAssetQueryKey(asset.id),
      enabled: expanded,
      refetchInterval: expanded && active ? 4000 : false,
    },
  });

  const observations = detail?.observations ?? [];

  function handleRetry() {
    retry.mutate(
      { id: asset.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMediaQueryKey() });
          queryClient.invalidateQueries({
            queryKey: getGetMediaAssetQueryKey(asset.id),
          });
          toast({ title: t("toastRequeued") });
        },
        onError: () =>
          toast({ title: t("toastRetryFailed"), variant: "destructive" }),
      },
    );
  }

  function handleDelete() {
    remove.mutate(
      { id: asset.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMediaQueryKey() });
          toast({ title: t("toastDeletedTitle"), description: t("toastDeletedDescription") });
        },
        onError: () =>
          toast({ title: t("toastDeleteFailed"), variant: "destructive" }),
      },
    );
  }

  return (
    <Card
      className="bg-card/40 border-primary/25 backdrop-blur-sm"
      data-testid={`media-${asset.id}`}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-9 h-9 rounded-none border border-primary/30 text-primary flex items-center justify-center">
            <Icon className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-display tracking-wider text-sm text-foreground truncate max-w-[16rem]">
                {asset.filename}
              </span>
              <Badge
                variant="outline"
                className="font-mono text-[8px] uppercase tracking-wider border-primary/40 text-primary/80"
              >
                {asset.modality}
              </Badge>
              <Badge
                variant="outline"
                className={`font-mono text-[8px] uppercase tracking-wider ${status.cls}`}
              >
                {status.pulse && (
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse mr-1" />
                )}
                {statusLabel(t, asset.status)}
              </Badge>
              <span className="font-mono text-[10px] text-muted-foreground/40 ml-auto">
                {relativeTime(t, asset.createdAt)}
              </span>
            </div>
            <div className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground/60">
              <span className="text-primary/70">
                {engram?.symbol ?? "◇"} {engram?.name ?? (asset.engramId == null ? t("pyriChat") : t("engramFallback", { id: asset.engramId }))}
              </span>
              <span>{formatBytes(asset.sizeBytes)}</span>
              {asset.status === "completed" && (
                <span className="text-emerald-400/70">
                  {t("observationCount", { count: asset.observationCount })}
                </span>
              )}
            </div>
            {asset.summary && (
              <p className="text-sm leading-relaxed font-sans text-foreground/85 mt-2">
                {asset.summary}
              </p>
            )}
          </div>
        </div>

        {/* Error */}
        {asset.status === "failed" && asset.error && (
          <div className="border border-rose-500/25 bg-rose-500/[0.04] p-3 space-y-1">
            <p className="font-mono text-[10px] uppercase tracking-wider text-rose-400/80 flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3" /> {t("perceptionFailed")}
            </p>
            <p className="text-xs font-mono text-rose-300/70 break-words">{asset.error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {asset.status === "failed" && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleRetry}
              disabled={retry.isPending}
              className="font-mono text-[10px] uppercase tracking-wider border-amber-500/40 text-amber-300 hover:bg-amber-500/10 h-8"
              data-testid={`button-retry-${asset.id}`}
            >
              <RotateCw className="w-3 h-3 mr-1.5" /> {t("retry")}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={handleDelete}
            disabled={remove.isPending}
            className="font-mono text-[10px] uppercase tracking-wider border-rose-500/40 text-rose-300 hover:bg-rose-500/10 h-8"
            data-testid={`button-delete-${asset.id}`}
          >
            <Trash2 className="w-3 h-3 mr-1.5" /> {t("delete")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setExpanded((v) => !v)}
            className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground h-8 ml-auto"
            data-testid={`button-detail-${asset.id}`}
          >
            {expanded ? (
              <ChevronDown className="w-3 h-3 mr-1.5" />
            ) : (
              <ChevronRight className="w-3 h-3 mr-1.5" />
            )}
            {t("details")}
          </Button>
        </div>

        {/* Detail */}
        {expanded && (
          <div
            className="border-t border-border/30 pt-3 space-y-3"
            data-testid={`media-detail-${asset.id}`}
          >
            {/* Preview */}
            {asset.modality === "image" && (
              <img
                src={`/api/media/${asset.id}/raw`}
                alt={asset.filename}
                className="max-h-64 border border-border/40 object-contain"
              />
            )}
            {asset.modality === "audio" && (
              <audio controls src={`/api/media/${asset.id}/raw`} className="w-full" />
            )}
            {asset.modality === "video" && (
              <video
                controls
                src={`/api/media/${asset.id}/raw`}
                className="max-h-72 w-full border border-border/40"
              />
            )}

            {/* Transcript */}
            {detail?.asset.transcript && (
              <div className="border border-border/30 bg-white/[0.02] p-3 space-y-1">
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70 flex items-center gap-1.5">
                  <ScrollText className="w-3 h-3" /> {t("transcript")}
                </p>
                <p className="text-xs leading-relaxed font-sans text-foreground/75 whitespace-pre-wrap">
                  {detail.asset.transcript}
                </p>
              </div>
            )}

            {/* Commentary */}
            {detail?.asset.commentary && (
              <div className="border border-primary/20 bg-primary/[0.04] p-3 space-y-1">
                <p className="font-mono text-[10px] uppercase tracking-wider text-primary/80 flex items-center gap-1.5">
                  <MessageSquareQuote className="w-3 h-3" /> {t("reacts", { name: engram?.name ?? t("engramGeneric") })}
                </p>
                <p className="text-sm leading-relaxed font-sans text-foreground/85 whitespace-pre-wrap">
                  {detail.asset.commentary}
                </p>
              </div>
            )}

            {/* Observations */}
            <div className="space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70 flex items-center gap-1.5">
                <Eye className="w-3 h-3" /> {t("observations")}
              </p>
              {active ? (
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/50 text-center py-3">
                  {t("perceiving")}
                </p>
              ) : !observations.length ? (
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/50 text-center py-3">
                  {t("noObservations")}
                </p>
              ) : (
                observations.map((o) => <ObservationRow key={o.id} entry={o} />)
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ObservationRow({ entry }: { entry: MediaObservationEntry }) {
  const { t } = useTranslation("media");
  return (
    <div
      className="flex gap-3 items-start"
      data-testid={`media-observation-${entry.id}`}
    >
      <div className="shrink-0 w-6 h-6 rounded-none border border-emerald-500/25 text-emerald-300/80 flex items-center justify-center">
        <Eye className="w-3 h-3" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-relaxed font-sans text-foreground/80">{entry.content}</p>
        <span className="font-mono text-[8px] uppercase tracking-wider text-emerald-400/50">
          {entry.provenance}
          {entry.source ? ` · ${entry.source}` : ""} · {t("conf", { value: entry.confidence.toFixed(2) })}
        </span>
      </div>
    </div>
  );
}
