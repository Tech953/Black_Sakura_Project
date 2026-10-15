import { useEffect, useRef, useState } from "react";
import { Clapperboard, Download, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
type AuthFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface MovieJob {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  error?: string;
  progress?: { completedFrames: number; totalFrames: number; percent: number };
  videoUrl?: string;
  auditUrl?: string;
  exportMetadata?: Record<string, unknown>;
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

async function downloadAuthenticated(
  authFetch: AuthFetch,
  url: string,
  filename: string,
) {
  const response = await authFetch(url);
  if (!response.ok) {
    const value = await response.json().catch(() => ({}));
    throw new Error(value.error ?? "Download failed.");
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
}

export function FullRezzMovieExportDialog({
  open,
  onOpenChange,
  authFetch,
  conversationId,
  messageId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  authFetch: AuthFetch;
  conversationId: number | null;
  messageId: number | null;
}) {
  const [fps, setFps] = useState<60 | 120 | 240>(60);
  const [mode, setMode] = useState<"2d" | "3d">("3d");
  const [job, setJob] = useState<MovieJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selectionKey =
    conversationId != null && messageId != null
      ? `${conversationId}:${messageId}`
      : null;
  const lastSelectionKey = useRef<string | null>(null);

  useEffect(() => {
    if (!selectionKey || selectionKey === lastSelectionKey.current) return;
    lastSelectionKey.current = selectionKey;
    setJob(null);
    setError("");
    setFps(60);
    setMode("3d");
  }, [selectionKey]);

  async function startExport() {
    if (conversationId == null || messageId == null) return;
    setBusy(true);
    setError("");
    try {
      const response = await authFetch(
        `${BASE}/api/full-rezz/conversations/${conversationId}/messages/${messageId}/movie-export`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fps, mode, width: 1280, height: 720 }),
        },
      );
      let current = await response.json();
      if (!response.ok) throw new Error(current.error ?? "Movie export could not start.");
      setJob(current as MovieJob);
      for (let attempt = 0; attempt < 1200; attempt += 1) {
        if (current.status !== "queued" && current.status !== "running") break;
        await delay(1500);
        const statusResponse = await authFetch(`${BASE}/api/full-rezz/jobs/${current.id}`);
        const next = await statusResponse.json();
        if (!statusResponse.ok) throw new Error(next.error ?? "Movie export status could not be read.");
        current = next;
        setJob(current as MovieJob);
      }
      if (current.status === "queued" || current.status === "running") {
        setError("Export is still running. You can close this dialog; the local job continues.");
      }
      if (current.status === "failed") {
        setError(current.error ?? "FULL_REZZ movie export failed.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "FULL_REZZ movie export failed.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelExport() {
    if (!job?.id) return;
    setBusy(true);
    try {
      const response = await authFetch(`${BASE}/api/full-rezz/jobs/${job.id}`, { method: "DELETE" });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "Export could not be cancelled.");
      setJob(value as MovieJob);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Export could not be cancelled.");
    } finally {
      setBusy(false);
    }
  }

  const running = job?.status === "queued" || job?.status === "running";
  const metadata = job?.exportMetadata ?? {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border/50 max-w-lg w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle className="font-display tracking-widest text-primary">
            FULL_REZZ · Movie export
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
            Exports a real .webm clip using the selected reply’s generated WAV. The bundled Studio Unit is a neutral demo character, not this engram’s likeness. The exporter includes its frame/audio audit.
          </p>
          {!job && (
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 font-mono text-[9px] text-muted-foreground">
                <span className="block">Renderer</span>
                <select
                  className="h-9 w-full rounded border border-border/60 bg-background px-2 text-xs text-foreground"
                  value={mode}
                  onChange={(event) => setMode(event.target.value as "2d" | "3d")}
                  disabled={busy}
                >
                  <option value="3d">3D depth render</option>
                  <option value="2d">2D painter</option>
                </select>
              </label>
              <label className="space-y-1 font-mono text-[9px] text-muted-foreground">
                <span className="block">Frame rate</span>
                <select
                  className="h-9 w-full rounded border border-border/60 bg-background px-2 text-xs text-foreground"
                  value={fps}
                  onChange={(event) => setFps(Number(event.target.value) as 60 | 120 | 240)}
                  disabled={busy}
                >
                  <option value={60}>60 fps</option>
                  <option value={120}>120 fps</option>
                  <option value={240}>240 fps</option>
                </select>
              </label>
            </div>
          )}
          {job && (
            <div className="space-y-2 border border-border/40 p-3">
              <p className="font-mono text-[10px] uppercase text-foreground/80">
                {job.status.replace("_", " ")}
              </p>
              {job.progress && (
                <>
                  <div className="h-2 overflow-hidden rounded bg-muted">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${job.progress.percent}%` }}
                    />
                  </div>
                  <p className="font-mono text-[9px] text-muted-foreground">
                    {job.progress.percent}% · {job.progress.completedFrames.toLocaleString()} / {job.progress.totalFrames.toLocaleString()} frames
                  </p>
                </>
              )}
              {job.status === "succeeded" && (
                <div className="space-y-2">
                  <p className="font-mono text-[9px] text-muted-foreground">
                    {String(metadata.fps ?? fps)} fps · {String(metadata.frames ?? "—")} frames · {String(metadata.duration_seconds ?? "—")} sec · {String(metadata.sha256 ?? "")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void downloadAuthenticated(
                        authFetch,
                        `${BASE}${job.videoUrl ?? `/api/full-rezz/jobs/${job.id}/video`}`,
                        `full-rezz-${job.id}.webm`,
                      ).catch((cause) => setError(cause instanceof Error ? cause.message : "Video download failed."))}
                    >
                      <Download className="mr-2 h-3.5 w-3.5" /> Download .webm
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void downloadAuthenticated(
                        authFetch,
                        `${BASE}${job.auditUrl ?? `/api/full-rezz/jobs/${job.id}/audit`}`,
                        `full-rezz-${job.id}.audit.json`,
                      ).catch((cause) => setError(cause instanceof Error ? cause.message : "Audit download failed."))}
                    >
                      <Download className="mr-2 h-3.5 w-3.5" /> Download audit
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
          {error && <p role="alert" className="font-mono text-[10px] text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            {running && (
              <Button type="button" variant="outline" onClick={() => void cancelExport()} disabled={busy}>
                <X className="mr-1 h-3 w-3" /> Cancel export
              </Button>
            )}
            {!job && (
              <Button type="button" onClick={() => void startExport()} disabled={busy || conversationId == null || messageId == null}>
                {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Clapperboard className="mr-2 h-3.5 w-3.5" />}
                Export movie
              </Button>
            )}
            {job && !running && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setJob(null);
                  setError("");
                }}
                disabled={busy}
              >
                New export
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
