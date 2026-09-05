import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useAuth } from "@clerk/react";
import { useListOpenaiConversations, useCreateOpenaiConversation, useDeleteOpenaiConversation, useListEngrams, getListOpenaiConversationsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Send, Upload, X, Loader2, MessageSquare, PanelLeft, Paperclip, Eye, AlertTriangle, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useEventStream, type EngramEvent } from "@/hooks/use-event-stream";
import { resolveReplyLanguage } from "@/i18n";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type EventTone = "info" | "warn" | "good";

interface SystemEvent {
  id: string;
  label: string;
  tone: EventTone;
  ts: string;
}

/** Render a live system event as a one-line strip entry, or null to hide it. */
function describeEvent(ev: EngramEvent, t: TFunction): { label: string; tone: EventTone } | null {
  const d = (ev.data ?? {}) as Record<string, unknown>;
  switch (ev.type) {
    case "presence.changed":
      return {
        label: t("eventPresenceChanged", {
          engramName: (d["engramName"] as string) ?? t("eventAnEngram"),
          spaceName: (d["spaceName"] as string) ?? t("eventASpace"),
        }),
        tone: "info",
      };
    case "controls.changed": {
      const bits = [d["paused"] ? t("eventControlsPaused") : t("eventControlsActive")];
      if (d["quietMode"]) bits.push(t("eventControlsQuiet"));
      return { label: t("eventControlsUpdated", { bits: bits.join(", ") }), tone: "warn" };
    }
    case "simulation.step":
      return {
        label: t("eventSimulationStep", {
          step: (d["step"] as number) ?? "?",
          maxSteps: (d["maxSteps"] as number) ?? "?",
        }),
        tone: "info",
      };
    case "media.completed":
      return {
        label: t("eventMediaCompleted", {
          modality: (d["modality"] as string) ?? t("eventMediaFallback"),
          filename: (d["filename"] as string) ?? "",
        }),
        tone: "good",
      };
    case "artifact.created":
      return { label: t("eventArtifactCreated", { kind: (d["kind"] as string) ?? t("eventArtifactFallback"), title: (d["title"] as string) ?? "" }), tone: "info" };
    case "artifact.completed":
      return { label: t("eventArtifactCompleted", { kind: (d["kind"] as string) ?? t("eventArtifactFallback"), title: (d["title"] as string) ?? "" }), tone: "good" };
    case "artifact.failed":
      return { label: t("eventArtifactFailed", { title: (d["title"] as string) ?? "" }), tone: "warn" };
    case "chat.self_initiated":
      return { label: t("eventChatSelfInitiated"), tone: "good" };
    case "artifact.updated":
    case "message.created":
      return null;
  }
}

type ChatMode = "informational" | "alert" | "tutorial" | "companion" | "analyst" | "silent" | "custom";

interface Message {
  id?: number;
  role: "user" | "assistant" | "context";
  content: string;
  speakerEngramId?: number | null;
  streaming?: boolean;
}

interface Attachment {
  id: number;
  filename: string;
  modality: string;
  status: "pending" | "processing" | "completed" | "failed";
  error?: string | null;
}

const UPLOAD_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,audio/*,video/mp4,video/quicktime,video/webm,.txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json";

interface Conversation {
  id: number;
  title: string;
  mode: string;
  personaName?: string | null;
  customEngram?: string | null;
  engramId?: number | null;
  engramIds?: number[];
  createdAt: string;
}

const MODES: { id: ChatMode; labelKey: string; glyph: string; descKey: string }[] = [
  { id: "informational", labelKey: "modeInformational", glyph: "◈", descKey: "modeInformationalDesc" },
  { id: "alert", labelKey: "modeAlert", glyph: "△", descKey: "modeAlertDesc" },
  { id: "tutorial", labelKey: "modeTutorial", glyph: "◎", descKey: "modeTutorialDesc" },
  { id: "companion", labelKey: "modeCompanion", glyph: "⟡", descKey: "modeCompanionDesc" },
  { id: "analyst", labelKey: "modeAnalyst", glyph: "⟐", descKey: "modeAnalystDesc" },
  { id: "silent", labelKey: "modeSilent", glyph: "⬡", descKey: "modeSilentDesc" },
  { id: "custom", labelKey: "modeCustom", glyph: "⌘", descKey: "modeCustomDesc" },
];

export default function Chat() {
  const { t } = useTranslation("chat");
  const { getToken } = useAuth();
  const { data: convList, isLoading: loadingList } = useListOpenaiConversations();
  const createConv = useCreateOpenaiConversation();
  const deleteConv = useDeleteOpenaiConversation();
  const { data: engrams } = useListEngrams();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [convMode, setConvMode] = useState<ChatMode>("companion");
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [customEngram, setCustomEngram] = useState("");
  const [selectedEngramIds, setSelectedEngramIds] = useState<number[]>([]);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [convSheetOpen, setConvSheetOpen] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [sysEvents, setSysEvents] = useState<SystemEvent[]>([]);
  const isMobile = useIsMobile();

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const authFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const token = await getToken();
      const headers = new Headers(init?.headers);
      if (token && !headers.has("authorization")) {
        headers.set("authorization", `Bearer ${token}`);
      }
      return fetch(input, { ...init, headers, credentials: "include" });
    },
    [getToken],
  );

  function scrollToBottom() {
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, 50);
  }

  useEffect(() => { scrollToBottom(); }, [messages]);

  const reloadMessages = useCallback(async (id: number) => {
    const resp = await authFetch(`${BASE}/api/openai/conversations/${id}`);
    if (!resp.ok) return;
    const data = await resp.json();
    setMessages(data.messages ?? []);
  }, [authFetch]);

  const loadConversation = useCallback(async (id: number) => {
    const resp = await authFetch(`${BASE}/api/openai/conversations/${id}`);
    if (!resp.ok) return;
    const data = await resp.json();
    const conv: Conversation = {
      id: data.id,
      title: data.title,
      mode: data.mode,
      personaName: data.personaName,
      customEngram: data.customEngram,
      engramId: data.engramId,
      engramIds: data.engramIds ?? (data.engramId != null ? [data.engramId] : []),
      createdAt: data.createdAt,
    };
    setMessages(data.messages ?? []);
    setAttachments([]);
    setActiveId(id);
    setConvMode((conv.mode as ChatMode) ?? "companion");
    setCustomEngram(conv.customEngram ?? "");
    setSelectedEngramIds(conv.engramIds ?? (conv.engramId != null ? [conv.engramId] : []));
    setConvSheetOpen(false);
    scrollToBottom();
  }, [authFetch]);

  const uploadFile = useCallback(async (file: File) => {
    const convId = activeId;
    if (!convId) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
       const resp = await authFetch(`${BASE}/api/openai/conversations/${convId}/media`, { method: "POST", body: form });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        toast({ title: t("toastUploadRejected"), description: err.error ?? t("toastHttpError", { status: resp.status }), variant: "destructive" });
        return;
      }
      const asset = await resp.json();
      setAttachments((prev) => [...prev, { id: asset.id, filename: asset.filename, modality: asset.modality, status: asset.status, error: asset.error }]);
    } catch {
      toast({ title: t("toastUploadFailed"), description: t("toastCouldNotReachApi"), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [activeId, authFetch, toast, t]);

  // Poll perception status for in-flight attachments until each settles.
  useEffect(() => {
    const inFlight = attachments.filter((a) => a.status === "pending" || a.status === "processing");
    if (inFlight.length === 0) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      for (const att of inFlight) {
        try {
           const resp = await authFetch(`${BASE}/api/media/${att.id}`);
          if (!resp.ok || cancelled) continue;
          const data = await resp.json();
          const status = data.asset.status as Attachment["status"];
          if (status !== att.status) {
            setAttachments((prev) => prev.map((a) => (a.id === att.id ? { ...a, status, error: data.asset.error } : a)));
          }
        } catch { /* transient — retry next tick */ }
      }
    }, 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [attachments, authFetch]);

  // When a perception completes, pull the `context` message the worker inserted into the
  // thread (only while not streaming, so we don't clobber an in-progress reply), then drop
  // the now-redundant attachment card. Failed cards stay until dismissed.
  useEffect(() => {
    const hasCompleted = attachments.some((a) => a.status === "completed");
    if (!hasCompleted || streaming || !activeId) return;
    let cancelled = false;
    (async () => {
      await reloadMessages(activeId);
      if (!cancelled) setAttachments((prev) => prev.filter((a) => a.status !== "completed"));
    })();
    return () => { cancelled = true; };
  }, [attachments, streaming, activeId, reloadMessages]);

  async function handleNewConversation() {
    if (!newTitle.trim()) return;
    const isGroup = selectedEngramIds.length >= 2;
    const result = await createConv.mutateAsync({
      data: {
        title: newTitle.trim(),
        mode: selectedEngramIds.length > 0 ? "companion" : convMode,
        customEngram: selectedEngramIds.length === 0 && convMode === "custom" ? customEngram : undefined,
        engramId: selectedEngramIds.length === 1 ? selectedEngramIds[0] : undefined,
        engramIds: isGroup ? selectedEngramIds : undefined,
      },
    });
    queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
    setShowNewDialog(false);
    setNewTitle("");
    setConvSheetOpen(false);
    await loadConversation(result.id);
  }

  function toggleEngram(id: number) {
    setSelectedEngramIds((prev) =>
      prev.includes(id) ? prev.filter((participantId) => participantId !== id) : [...prev, id],
    );
  }

  async function handleDelete(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    await deleteConv.mutateAsync({ id });
    queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
    toast({ title: t("toastConversationDeleted") });
  }

  async function handleSend() {
    if (!input.trim() || streaming || !activeId) return;
    const userMsg = input.trim();
    const groupParticipantIds = activeConv?.engramIds ?? [];
    const isGroup = groupParticipantIds.length >= 2;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setStreaming(true);
    const assistantIdx = messages.length + 1;
    if (!isGroup) {
      setMessages((prev) => [...prev, { role: "assistant", content: "", streaming: true }]);
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let responseStatus: number | null = null;
    try {
      const resp = await authFetch(`${BASE}/api/openai/conversations/${activeId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: userMsg, language: resolveReplyLanguage() }),
        signal: ctrl.signal,
      });
      responseStatus = resp.status;

      if (!resp.ok || !resp.body) {
        throw new Error(`Stream failed (${resp.status})`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const payload = JSON.parse(raw);
            if (payload.done) break;
            if (payload.error) {
              toast({ title: t("toastGenerationError"), description: payload.error, variant: "destructive" });
              break;
            }
            if (payload.content) {
              if (payload.speakerEngramId != null) {
                setMessages((prev) => [
                  ...prev,
                  {
                    role: "assistant",
                    content: payload.content,
                    speakerEngramId: payload.speakerEngramId,
                  },
                ]);
              } else {
                accumulated += payload.content;
                setMessages((prev) => {
                  const next = [...prev];
                  const idx = next.findIndex((m, i) => i === assistantIdx);
                  if (idx !== -1) next[idx] = { ...next[idx], content: accumulated };
                  return next;
                });
              }
            }
          } catch {}
        }
      }

      if (!isGroup) {
        setMessages((prev) => {
          const next = [...prev];
          const idx = next.findIndex((m, i) => i === assistantIdx);
          if (idx !== -1) next[idx] = { role: "assistant", content: accumulated };
          return next;
        });
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        toast({
          title: t("toastNetworkError"),
          description:
            responseStatus !== null
              ? t("toastHttpError", { status: responseStatus })
              : t("toastCouldNotReachApi"),
          variant: "destructive",
        });
      }
      setMessages((prev) => prev.filter((_, i) => i !== assistantIdx));
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleEngamorUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCustomEngram(ev.target?.result as string ?? "");
    reader.readAsText(file);
  }

  const activeConv = (convList ?? []).find((c: Conversation) => c.id === activeId);
  const modeInfo = MODES.find((m) => m.id === (activeConv?.mode ?? convMode));
  const activeEngram = (engrams ?? []).find((e) => e.id === activeConv?.engramId);
  const activeGroupEngrams = (engrams ?? []).filter((e) => (activeConv?.engramIds ?? []).includes(e.id));
  const isActiveGroup = activeGroupEngrams.length >= 2;
  const engramById = new Map((engrams ?? []).map((e) => [e.id, e]));

  // Live push: subscribe scoped to this conversation + its engram. Server filters so we
  // only receive global events plus those matching our engramId/conversationId.
  const liveConnected = useEventStream(
    { engramId: activeConv?.engramId ?? null, conversationId: activeId },
    (ev) => {
      // A new chat turn we didn't author (self-initiated post, or another viewer) — pull it
      // in, but never mid-stream so we don't clobber an in-progress reply.
      if (ev.type === "message.created" || ev.type === "chat.self_initiated") {
        if (activeId !== null && ev.conversationId === activeId && !streaming) {
          reloadMessages(activeId);
        }
      }
      const described = describeEvent(ev, t);
      if (!described) return;
      setSysEvents((prev) =>
        [
          {
            id: `${ev.type}-${ev.ts}-${Math.random().toString(36).slice(2, 7)}`,
            label: described.label,
            tone: described.tone,
            ts: ev.ts,
          },
          ...prev,
        ].slice(0, 4),
      );
    },
  );

  const sidebar = (
    <div className="flex flex-col h-full bg-card/20 backdrop-blur-sm">
        <div className="p-4 border-b border-border/50 flex items-center justify-between">
          <div>
            <h2 className="font-mono text-xs uppercase tracking-widest text-primary">{t("conversations")}</h2>
            <p className="font-mono text-[9px] text-muted-foreground/50 mt-0.5">{t("lpemDialogueInterface")}</p>
          </div>
          <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
            <DialogTrigger asChild>
               <Button
                 size="icon"
                 variant="ghost"
                 className="w-7 h-7 text-primary hover:bg-primary/10"
                 onClick={() => {
                   setSelectedEngramIds([]);
                   setNewTitle("");
                 }}
               >
                <Plus className="w-4 h-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border/50 max-w-sm w-[calc(100vw-2rem)]">
              <DialogHeader>
                <DialogTitle className="font-display tracking-widest text-primary">{t("newConversation")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div>
                  <label className="font-mono text-[10px] uppercase text-muted-foreground tracking-wider">{t("titleLabel")}</label>
                  <Input value={newTitle} onChange={e => setNewTitle(e.target.value)}
                    placeholder={t("threadNamePlaceholder")} className="mt-1 font-mono text-sm border-border/50 bg-background/50"
                    onKeyDown={e => e.key === "Enter" && handleNewConversation()} />
                </div>
                {(engrams ?? []).length > 0 && (
                  <div>
                    <label className="font-mono text-[10px] uppercase text-muted-foreground tracking-wider mb-2 block">{t("talkTo")}</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        onClick={() => setSelectedEngramIds([])}
                        className={`flex items-center gap-2 px-2.5 py-2 border font-mono text-xs transition-colors ${selectedEngramIds.length === 0 ? "border-primary/50 bg-primary/10 text-primary" : "border-border/30 text-muted-foreground hover:border-primary/30 hover:text-foreground"}`}
                      >
                        <span>◈</span>
                        <span className="uppercase tracking-wider text-[10px]">PYRI</span>
                      </button>
                      {(engrams ?? []).filter((e) => !e.isArchival).map((e) => (
                        <button
                          key={e.id}
                          onClick={() => toggleEngram(e.id)}
                          className={`flex items-center gap-2 px-2.5 py-2 border font-mono text-xs transition-colors ${selectedEngramIds.includes(e.id) ? "border-primary/50 bg-primary/10 text-primary" : "border-border/30 text-muted-foreground hover:border-primary/30 hover:text-foreground"}`}
                        >
                          <span>{e.symbol}</span>
                          <span className="uppercase tracking-wider text-[10px]">{e.name}</span>
                        </button>
                      ))}
                    </div>
                    <p className="font-mono text-[9px] text-muted-foreground/50 mt-1">
                      {selectedEngramIds.length >= 2
                        ? t("groupChatHint", { count: selectedEngramIds.length })
                        : t("talkToHint")}
                    </p>
                    {selectedEngramIds.length >= 2 && (
                      <div className="mt-2 border border-primary/20 bg-primary/5 px-2.5 py-2 font-mono text-[9px] leading-relaxed text-primary/70">
                        {t("groupConsentNotice")}
                      </div>
                    )}
                  </div>
                )}
                {selectedEngramIds.length === 0 && (
                  <>
                    <div>
                      <label className="font-mono text-[10px] uppercase text-muted-foreground tracking-wider mb-2 block">{t("lpemMode")}</label>
                      <div className="grid grid-cols-2 gap-1.5">
                        {MODES.map((m) => (
                          <Tooltip key={m.id}>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => setConvMode(m.id)}
                                className={`flex items-center gap-2 px-2.5 py-2 border font-mono text-xs transition-colors ${convMode === m.id ? "border-primary/50 bg-primary/10 text-primary" : "border-border/30 text-muted-foreground hover:border-primary/30 hover:text-foreground"}`}
                              >
                                <span>{m.glyph}</span>
                                <span className="uppercase tracking-wider text-[10px]">{t(m.labelKey)}</span>
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="font-mono text-xs">{t(m.descKey)}</TooltipContent>
                          </Tooltip>
                        ))}
                      </div>
                    </div>
                    {convMode === "custom" && (
                      <div className="space-y-2">
                        <label className="font-mono text-[10px] uppercase text-muted-foreground tracking-wider">{t("customEngramLabel")}</label>
                        <Textarea
                          value={customEngram}
                          onChange={e => setCustomEngram(e.target.value)}
                          placeholder={t("customEngramPlaceholder")}
                          className="font-mono text-xs border-border/50 bg-background/50 min-h-24 resize-none"
                        />
                        <label className="flex items-center gap-2 cursor-pointer text-xs font-mono text-primary/70 hover:text-primary transition-colors">
                          <Upload className="w-3 h-3" />
                          {t("uploadEngramFile")}
                          <input type="file" accept=".engram,.txt,.md,.json" onChange={handleEngamorUpload} className="sr-only" />
                        </label>
                      </div>
                    )}
                  </>
                )}
                <Button onClick={handleNewConversation} disabled={createConv.isPending || !newTitle.trim()}
                  className="w-full font-mono text-xs uppercase tracking-wider bg-primary text-primary-foreground">
                  {createConv.isPending ? t("creating") : t("startConversation")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {loadingList ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 bg-primary/5" />)
            ) : !(convList ?? []).length ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/40 font-mono text-center">
                <MessageSquare className="w-6 h-6 mb-2" />
                <p className="text-[10px] uppercase">{t("noConversations")}</p>
              </div>
            ) : (
              (convList as Conversation[]).map((c) => {
                const listEngram = (engrams ?? []).find((e) => e.id === c.engramId);
                const listParticipants = (engrams ?? []).filter((e) => (c.engramIds ?? []).includes(e.id));
                const modeGlyph = listParticipants.length > 1
                  ? "◉"
                  : listEngram?.symbol ?? MODES.find((m) => m.id === c.mode)?.glyph ?? "◈";
                const modeLabel = listParticipants.length > 1
                  ? listParticipants.map((e) => e.name).join(" · ")
                  : listEngram?.name ?? c.mode;
                return (
                  <div
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => loadConversation(c.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        loadConversation(c.id);
                      }
                    }}
                    className={`w-full text-left px-3 py-2.5 border-l-2 transition-all group flex items-start gap-2 ${activeId === c.id ? "border-primary bg-primary/10" : "border-transparent hover:bg-white/5 hover:border-white/20"}`}
                  >
                    <span className="text-primary/60 text-sm mt-0.5">{modeGlyph}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`font-mono text-xs truncate ${activeId === c.id ? "text-primary" : "text-foreground/80"}`}>{c.title}</p>
                      <p className="font-mono text-[9px] text-muted-foreground/50 uppercase mt-0.5 truncate">{modeLabel}</p>
                    </div>
                    <button
                      onClick={(e) => handleDelete(c.id, e)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-rose-400 shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
    </div>
  );

  return (
    <div className="flex h-full gap-0 -m-4 md:-m-8 animate-in fade-in duration-500">
      {!isMobile && (
        <div className="w-64 flex-shrink-0 border-r border-border/50 flex flex-col">
          {sidebar}
        </div>
      )}
      {isMobile && (
        <Sheet open={convSheetOpen} onOpenChange={setConvSheetOpen}>
          <SheetContent side="left" aria-describedby={undefined} className="w-80 max-w-[85vw] p-0 border-border/50">
            <SheetTitle className="sr-only">{t("conversations")}</SheetTitle>
            {sidebar}
          </SheetContent>
        </Sheet>
      )}

      {/* Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat Header */}
        <div className="h-12 border-b border-border/50 px-4 md:px-6 flex items-center gap-2 md:gap-3 bg-background/50 backdrop-blur-sm shrink-0">
          {isMobile && (
            <button
              aria-label={t("openConversations")}
              onClick={() => setConvSheetOpen(true)}
              className="flex items-center justify-center w-8 h-8 -ml-1 text-foreground/70 hover:text-primary transition-colors shrink-0"
            >
              <PanelLeft className="w-4 h-4" />
            </button>
          )}
          {activeConv ? (
            <>
              <span className="text-primary text-base">
                {isActiveGroup ? <Users className="w-4 h-4" /> : activeEngram ? activeEngram.symbol : modeInfo?.glyph}
              </span>
              <span className="font-mono text-xs text-foreground/80 truncate">{activeConv.title}</span>
              <div className="ml-auto flex items-center gap-2 shrink-0">
                <span
                  title={liveConnected ? t("liveUpdatesConnected") : t("liveUpdatesReconnecting")}
                  className={`flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider ${liveConnected ? "text-emerald-400/80" : "text-muted-foreground/40"}`}
                >
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${liveConnected ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground/40"}`} />
                  {t("live")}
                </span>
                {activeEngram?.isArchival && (
                  <Badge variant="outline" className="font-mono text-[9px] uppercase tracking-wider border-amber-400/40 text-amber-400/90">
                    {t("common:archivalBadge")}
                  </Badge>
                )}
                <Badge variant="outline" className="font-mono text-[9px] uppercase tracking-wider border-primary/30 text-primary/70">
                  {isActiveGroup ? activeGroupEngrams.map((e) => e.name).join(" · ") : activeEngram ? activeEngram.name : activeConv.mode}
                </Badge>
              </div>
            </>
          ) : (
            <span className="font-mono text-xs text-muted-foreground/50 uppercase tracking-widest">{t("selectOrCreate")}</span>
          )}
        </div>

        {/* Live system-event strip */}
        {sysEvents.length > 0 && (
          <div className="border-b border-border/40 bg-background/30 px-4 md:px-6 py-1.5 space-y-1 shrink-0">
            {sysEvents.map((e) => (
              <div key={e.id} className="flex items-center gap-2 font-mono text-[10px]">
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                    e.tone === "good" ? "bg-emerald-400" : e.tone === "warn" ? "bg-amber-400" : "bg-cyan-400"
                  }`}
                />
                <span className="text-muted-foreground/70 truncate">{e.label}</span>
                <span className="text-muted-foreground/30 ml-auto shrink-0">{new Date(e.ts).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-4">
          {!activeId ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground/40 font-mono">
              <div className="text-5xl mb-4">◈</div>
              <p className="text-sm uppercase tracking-widest">{t("dialogueInterfaceTitle")}</p>
              <p className="text-xs mt-2 text-muted-foreground/30">{t("createToBegin")}</p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {MODES.map((m) => (
                  <span key={m.id} className="font-mono text-[10px] text-muted-foreground/30 border border-muted/20 px-2 py-1">
                    {m.glyph} {t(m.labelKey)}
                  </span>
                ))}
              </div>
            </div>
          ) : !messages.length ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground/40 font-mono">
              <span className="text-3xl mb-3">{modeInfo?.glyph}</span>
              <p className="text-xs uppercase tracking-widest">{modeInfo ? t(modeInfo.descKey) : ""}</p>
              <p className="text-[10px] mt-1 text-muted-foreground/30">{t("sendToBegin")}</p>
            </div>
          ) : (
            messages.map((msg, idx) => {
              if (msg.role === "context") {
                return (
                  <div key={idx} className="flex justify-center">
                    <div className="w-full max-w-[90%] md:max-w-[82%]">
                      <div className="font-mono text-[9px] uppercase tracking-widest mb-1 text-cyan-300/60 flex items-center justify-center gap-1.5">
                        <Eye className="w-3 h-3" /> {t("perceivedContext")}
                      </div>
                      <div className="px-4 py-3 text-xs leading-relaxed font-mono whitespace-pre-wrap bg-cyan-500/[0.06] border border-dashed border-cyan-400/30 text-foreground/70">
                        {msg.content}
                      </div>
                    </div>
                  </div>
                );
              }
              return (
                <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] md:max-w-[78%] ${msg.role === "user" ? "order-1" : ""}`}>
                    <div className={`font-mono text-[9px] uppercase tracking-widest mb-1 ${msg.role === "user" ? "text-right text-muted-foreground/50" : "text-primary/50"}`}>
                      {msg.role === "user"
                        ? t("you")
                        : msg.speakerEngramId != null
                          ? `${engramById.get(msg.speakerEngramId)?.name?.toUpperCase() ?? t("engramFallback")} · ${engramById.get(msg.speakerEngramId)?.symbol ?? "◈"}`
                          : activeEngram
                            ? `${activeEngram.name.toUpperCase()} · ${activeEngram.symbol}`
                            : isActiveGroup
                              ? t("groupReply")
                              : `PYRI · ${modeInfo?.glyph ?? "◈"}`}
                    </div>
                    <div className={`px-4 py-3 text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-primary/10 border border-primary/20 text-foreground"
                        : "bg-card/40 border border-border/50 text-foreground/90 backdrop-blur-sm"
                    }`}>
                      {msg.content || (msg.streaming && (
                        <span className="flex items-center gap-1 text-muted-foreground/50">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span className="font-mono text-[10px]">{t("generating")}</span>
                        </span>
                      ))}
                      {msg.streaming && msg.content && (
                        <span className="inline-block w-0.5 h-4 bg-primary/70 animate-pulse ml-0.5 align-text-bottom" />
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Input area */}
        <div
          className={`border-t p-3 md:p-4 bg-background/50 backdrop-blur-sm shrink-0 transition-colors ${dragOver ? "border-primary/60 bg-primary/5" : "border-border/50"}`}
          onDragOver={(e) => { if (activeId && !streaming) { e.preventDefault(); setDragOver(true); } }}
          onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (!activeId || streaming) return;
            const file = e.dataTransfer.files?.[0];
            if (file && !activeGroupEngrams.some((e) => e.isArchival) && !activeEngram?.isArchival) uploadFile(file);
          }}
        >
          {attachments.length > 0 && (
            <div className="max-w-4xl mx-auto mb-2 flex flex-wrap gap-2">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className={`flex items-center gap-2 px-2.5 py-1.5 border font-mono text-[10px] ${att.status === "failed" ? "border-rose-500/40 bg-rose-500/5 text-rose-300" : "border-primary/30 bg-primary/5 text-primary/80"}`}
                >
                  {att.status === "failed" ? <AlertTriangle className="w-3 h-3 shrink-0" /> : <Loader2 className="w-3 h-3 animate-spin shrink-0" />}
                  <span className="truncate max-w-[140px]">{att.filename}</span>
                  <span className="uppercase text-muted-foreground/50">{att.status === "failed" ? t("attachmentFailed") : t("attachmentPerceiving")}</span>
                  {att.status === "failed" && (
                    <button
                      onClick={() => setAttachments((p) => p.filter((a) => a.id !== att.id))}
                      className="hover:text-rose-200"
                      aria-label={t("dismissAttachment")}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 md:gap-3 items-end max-w-4xl mx-auto">
            <input
              ref={fileInputRef}
              type="file"
              accept={UPLOAD_ACCEPT}
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadFile(file);
                e.target.value = "";
              }}
            />
            <Button
              size="icon"
              variant="outline"
              disabled={!activeId || uploading || streaming || activeEngram?.isArchival || activeGroupEngrams.some((e) => e.isArchival)}
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 border-border/50 text-primary/70 hover:bg-primary/10 h-11 w-11"
              aria-label={t("attachMedia")}
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
            </Button>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                activeEngram?.isArchival || activeGroupEngrams.some((e) => e.isArchival)
                  ? t("archivalPlaceholder")
                  : activeId
                    ? t("messagePyriPlaceholder", { mode: convMode })
                    : t("selectConversationFirst")
              }
              disabled={!activeId || streaming}
              className="flex-1 font-mono text-sm border-border/50 bg-card/30 resize-none min-h-[44px] max-h-32 py-3 placeholder:text-muted-foreground/30"
              rows={1}
            />
            {streaming ? (
              <Button
                size="icon"
                variant="outline"
                className="shrink-0 border-rose-500/40 text-rose-400 hover:bg-rose-500/10 h-11 w-11"
                onClick={() => abortRef.current?.abort()}
              >
                <X className="w-4 h-4" />
              </Button>
            ) : (
              <Button
                size="icon"
                disabled={!activeId || !input.trim()}
                onClick={handleSend}
                className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 h-11 w-11"
              >
                <Send className="w-4 h-4" />
              </Button>
            )}
          </div>
          <p className="font-mono text-[9px] text-muted-foreground/30 text-center mt-2">
            {t("inputHint", {
              name: isActiveGroup
                ? activeGroupEngrams.map((e) => e.name).join(", ")
                : activeEngram ? activeEngram.name : "PYRI",
            })}
          </p>
        </div>
      </div>
    </div>
  );
}
