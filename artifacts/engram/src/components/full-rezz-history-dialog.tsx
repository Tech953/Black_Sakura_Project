import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const PAGE_SIZE = 50;

type AuthFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface HistoryPage {
  count: number;
  profile_id: string;
  imports: Array<{
    import_id: string;
    filename: string;
    source_sha256: string;
    message_count: number;
    created_at: string;
  }>;
  messages: Array<{
    message_id: string;
    role: string;
    content: string;
    timestamp?: string | null;
  }>;
}

interface HistoryPreview {
  filename: string;
  source_sha256: string;
  message_count: number;
  role_counts: Record<string, number>;
  already_imported: boolean;
  sample: Array<{ role: string; content: string }>;
}

export function FullRezzHistoryDialog({
  open,
  onOpenChange,
  authFetch,
  engramId,
  engramName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  authFetch: AuthFetch;
  engramId: number;
  engramName: string;
}) {
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState("{}");
  const [preview, setPreview] = useState<HistoryPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [runtimeAvailable, setRuntimeAvailable] = useState<boolean | null>(null);
  const [runtimeReason, setRuntimeReason] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRuntimeAvailable(null);
    setRuntimeReason("");
    void authFetch(`${BASE}/api/full-rezz/status`)
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok) throw new Error(value.error ?? "FULL_REZZ runtime status is unavailable.");
        if (cancelled) return;
        setRuntimeAvailable(value.available === true);
        setRuntimeReason(value.reason ?? "");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setRuntimeAvailable(false);
        setRuntimeReason(cause instanceof Error ? cause.message : "FULL_REZZ runtime status is unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, authFetch]);

  useEffect(() => {
    if (!open) return;
    if (runtimeAvailable !== true) return;
    let cancelled = false;
    setError("");
    void authFetch(
      `${BASE}/api/full-rezz/engrams/${engramId}/history?limit=${PAGE_SIZE}&offset=${offset}`,
    )
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok) throw new Error(value.error ?? "History could not be loaded.");
        if (!cancelled) setPage(value as HistoryPage);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "History could not be loaded.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, engramId, offset, refreshKey, authFetch, runtimeAvailable]);

  async function previewFile(selected: File | null) {
    setFile(selected);
    setPreview(null);
    setError("");
    if (!selected) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", selected);
      form.append("mapping", mapping);
      const response = await authFetch(
        `${BASE}/api/full-rezz/engrams/${engramId}/history/import-preview`,
        { method: "POST", body: form },
      );
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "History preview failed.");
      setPreview(value as HistoryPreview);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "History preview failed.");
    } finally {
      setBusy(false);
    }
  }

  async function importHistory() {
    if (!file || !preview) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mapping", mapping);
      const response = await authFetch(
        `${BASE}/api/full-rezz/engrams/${engramId}/history/import`,
        { method: "POST", body: form },
      );
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "History import failed.");
      setPreview(null);
      setFile(null);
      setOffset(0);
      setRefreshKey((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "History import failed.");
    } finally {
      setBusy(false);
    }
  }

  async function exportHistory() {
    setBusy(true);
    setError("");
    try {
      const response = await authFetch(
        `${BASE}/api/full-rezz/engrams/${engramId}/history/export`,
      );
      if (!response.ok) {
        const value = await response.json();
        throw new Error(value.error ?? "History export failed.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `engram-${engramId}-full-rezz-history.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "History export failed.");
    } finally {
      setBusy(false);
    }
  }

  async function rollbackImport(record: HistoryPage["imports"][number]) {
    const confirmed = window.confirm(
      `Remove ${record.message_count.toLocaleString()} transcript messages and the original source bytes for “${record.filename}”? Stored context excerpts from this import will also be removed. Host chat messages already produced are not erased.`,
    );
    if (!confirmed) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await authFetch(
        `${BASE}/api/full-rezz/engrams/${engramId}/history/imports/${record.import_id}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirm: true }),
        },
      );
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "History rollback failed.");
      setNotice(
        value.rolled_back
          ? `Removed ${Number(value.removed_message_count ?? 0).toLocaleString()} imported messages and their source bytes. Existing host chat messages remain.`
          : "That history import was already absent.",
      );
      setOffset(0);
      setRefreshKey((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "History rollback failed.");
    } finally {
      setBusy(false);
    }
  }

  const messages = page?.messages ?? [];
  const hasEarlier = offset > 0;
  const hasLater = page != null && offset + messages.length < page.count;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border/50 max-w-2xl w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display tracking-widest text-primary">
            FULL_REZZ · History for {engramName}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-[10px] text-muted-foreground">
              {page ? `${page.count.toLocaleString()} retained messages · ${page.imports.length} source imports` : "Loading history…"}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 font-mono text-[9px]"
                onClick={() => setRefreshKey((current) => current + 1)}
                disabled={busy || runtimeAvailable !== true}
              >
                <RefreshCw className="mr-1 h-3 w-3" /> Refresh
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 font-mono text-[9px]"
                onClick={() => void exportHistory()}
                disabled={busy || runtimeAvailable !== true || !page?.count}
              >
                <Download className="mr-1 h-3 w-3" /> Export complete archive
              </Button>
            </div>
          </div>
          <p className="font-mono text-[9px] leading-relaxed text-muted-foreground/70">
            Full export includes the original uploaded bytes (base64), retained messages, source provenance, and turn receipts; large archives can produce large downloads.
          </p>
          {runtimeAvailable === false && (
            <p className="border border-amber-400/30 bg-amber-400/5 px-3 py-2 font-mono text-[10px] text-amber-200">
              {runtimeReason || "The verified local FULL_REZZ runtime is unavailable."}
            </p>
          )}

          <section className="space-y-3 border border-border/40 p-3">
            <div>
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-foreground/80">
                Import conversation history
              </h3>
              <p className="mt-1 font-mono text-[9px] leading-relaxed text-muted-foreground">
                JSON, JSONL, explicitly mapped CSV, or reviewed speaker-label TXT/MD · 128 MiB maximum.
                Imports stay in the separate FULL_REZZ transcript store; they are not fictional memories or executable instructions.
              </p>
            </div>
            <Input
              type="file"
              accept=".json,.jsonl,.csv,.txt,.md,application/json,text/csv,text/plain"
              className="font-mono text-[10px]"
              onChange={(event) => void previewFile(event.target.files?.[0] ?? null)}
              disabled={busy || runtimeAvailable !== true}
            />
            <label className="block space-y-1">
              <span className="font-mono text-[9px] text-muted-foreground">
                Optional JSON field/speaker mapping
              </span>
              <Textarea
                value={mapping}
                onChange={(event) => {
                  setMapping(event.target.value);
                  setPreview(null);
                }}
                rows={3}
                className="font-mono text-[10px]"
                placeholder='{"role":"speaker","content":"message","speakers":{"Me":"user","Assistant":"assistant"}}'
                disabled={busy || runtimeAvailable !== true}
              />
            </label>
            <p className="font-mono text-[9px] text-muted-foreground/70">
              CSV mapping example: {`{"role":"speaker","content":"message","speakers":{"Me":"user","Assistant":"assistant"}}`}
              . TXT/MD example: {`{"speakers":{"Me":"user","Assistant":"assistant"}}`}.
            </p>
              {file && !preview && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void previewFile(file)}
                  disabled={busy || runtimeAvailable !== true}
                >
                  {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-2 h-3.5 w-3.5" />}
                  Preview selected file
                </Button>
              )}
            {preview && (
              <div className="space-y-2 border border-primary/20 bg-primary/5 p-3">
                <p className="font-mono text-[10px] text-foreground">
                  {preview.filename} · {preview.message_count.toLocaleString()} messages · SHA-256 {preview.source_sha256}
                </p>
                <p className="font-mono text-[9px] text-muted-foreground">
                  Roles: {Object.entries(preview.role_counts).map(([role, count]) => `${role} ${count}`).join(" · ")}
                  {preview.already_imported ? " · This exact source was imported before." : ""}
                </p>
                {preview.sample.map((row, index) => (
                  <div key={`${row.role}-${index}`} className="border-t border-border/40 pt-2">
                    <span className="font-mono text-[9px] uppercase text-primary/70">{row.role}</span>
                    <p className="whitespace-pre-wrap break-words text-xs text-foreground/80">{row.content}</p>
                  </div>
                ))}
                <Button
                  type="button"
                  onClick={() => void importHistory()}
                  disabled={busy || runtimeAvailable !== true}
                >
                  {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-2 h-3.5 w-3.5" />}
                  Confirm import
                </Button>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-foreground/80">
              Retained transcript
            </h3>
            {messages.length === 0 ? (
              <p className="border border-border/30 p-3 font-mono text-[10px] text-muted-foreground">
                No imported FULL_REZZ history yet.
              </p>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto border border-border/30 p-3">
                {messages.map((message) => (
                  <article key={message.message_id} className="border-b border-border/30 pb-2 last:border-0">
                    <div className="font-mono text-[9px] uppercase text-primary/70">
                      {message.role}{message.timestamp ? ` · ${message.timestamp}` : ""}
                    </div>
                    <p className="whitespace-pre-wrap break-words text-xs text-foreground/80">{message.content}</p>
                  </article>
                ))}
              </div>
            )}
            {!!page?.imports.length && (
              <div className="space-y-2">
                <h4 className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  Recent imported sources
                </h4>
                {page.imports.slice(-10).reverse().map((record) => (
                  <div key={record.import_id} className="flex flex-wrap items-center justify-between gap-2 border border-border/30 px-2 py-1.5">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[9px] text-foreground/80">
                        {record.filename} · {record.message_count.toLocaleString()} messages
                      </p>
                      <p className="truncate font-mono text-[8px] text-muted-foreground">
                        {record.source_sha256}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 text-destructive"
                      onClick={() => void rollbackImport(record)}
                      disabled={busy || runtimeAvailable !== true}
                      title="Remove this imported source and its messages"
                    >
                      <Trash2 className="mr-1 h-3 w-3" /> Roll back
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
                disabled={!hasEarlier || busy}
              >
                <ChevronLeft className="mr-1 h-3 w-3" /> Earlier
              </Button>
              <span className="font-mono text-[9px] text-muted-foreground">
                {messages.length ? `${offset + 1}–${offset + messages.length} of ${page?.count ?? 0}` : ""}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setOffset((value) => value + PAGE_SIZE)}
                disabled={!hasLater || busy}
              >
                Later <ChevronRight className="ml-1 h-3 w-3" />
              </Button>
            </div>
          </section>
          {notice && <p role="status" className="font-mono text-[10px] text-emerald-300">{notice}</p>}
          {error && <p role="alert" className="font-mono text-[10px] text-destructive">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
