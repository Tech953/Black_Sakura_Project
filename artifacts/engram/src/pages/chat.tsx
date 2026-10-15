import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useAuth } from "@clerk/react";
import {
  type Engram,
  useListOpenaiConversations,
  useCreateOpenaiConversation,
  useDeleteOpenaiConversation,
  useArchiveOpenaiConversation,
  useUpdateOpenaiConversationContinuation,
  useListEngrams,
  getListOpenaiConversationsQueryKey,
  normalizeMediaUploadMimeType,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Button } from "@/components/ui/button";
import { FullRezzPresenter } from "@/components/full-rezz-presenter";
import { FullRezzHistoryDialog } from "@/components/full-rezz-history-dialog";
import { FullRezzMovieExportDialog } from "@/components/full-rezz-movie-export-dialog";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Send, Upload, X, Loader2, MessageSquare, PanelLeft, Paperclip, Eye, AlertTriangle, Users, Download, Archive, ArchiveRestore, Settings2, Volume2, History, Clapperboard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useEventStream } from "@/hooks/use-event-stream";
import { resolveReplyLanguage } from "@/i18n";
import {
  buildMarkdownTranscript,
  buildPlainTextTranscript,
  buildTranscriptEntries,
} from "@/lib/chat-export";
import { describeSystemEvent, type SystemEvent } from "@/lib/system-event";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function describeDeleteFailure(error: unknown, t: TFunction): string {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;

  if (status === 408 || status === 502 || status === 503 || status === 504) {
    return t("toastDeleteUnavailable");
  }
  if (typeof status === "number") {
    return status >= 400 && status < 500
      ? t("toastDeleteRejected")
      : t("toastDeleteUnexpected");
  }
  if (
    error instanceof TypeError ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    return t("toastDeleteUnavailable");
  }
  return t("toastDeleteUnexpected");
}

function continuationReasonLabel(reason: string | undefined, t: TFunction): string {
  if (!reason) return t("groupContinuationReasonGeneric");
  if (reason.includes("archival")) return t("groupContinuationReasonArchival");
  if (reason.includes("autonomy")) return t("groupContinuationReasonAutonomy");
  if (reason.includes("paused")) return t("groupContinuationReasonPaused");
  if (reason.includes("resting")) return t("groupContinuationReasonResting");
  if (reason.includes("mode")) return t("groupContinuationReasonMode");
  if (reason.includes("space")) return t("groupContinuationReasonSpace");
  return t("groupContinuationReasonGeneric");
}

type ChatMode = "informational" | "alert" | "tutorial" | "companion" | "analyst" | "silent" | "custom";
type GroupContinuationMode = "off" | "short" | "extended";

interface Message {
  id?: number;
  role: "user" | "assistant" | "context";
  content: string;
  speakerEngramId?: number | null;
  createdAt?: string;
  streaming?: boolean;
}

interface Attachment {
  id: number;
  filename: string;
  modality: string;
  status: "pending" | "processing" | "completed" | "failed";
  error?: string | null;
}

interface FullRezzProfileChoice {
  id: string;
  name: string;
  referenceCount: number;
  sourceCount: number;
}

interface FullRezzPreview {
  packId: string;
  schemaVersion: string;
  profiles: FullRezzProfileChoice[];
}

interface SpeechJobView {
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  error?: string;
  audioUrl?: string;
  turnId?: string;
  generationIds?: string[];
  audioObjectUrl?: string;
}

type FullRezzReviewValue = "unreviewed" | "acceptable" | "needs_revision";
type FullRezzReviewRatings = Record<
  "likeness" | "naturalness" | "delivery" | "reference_purity" | "canon_boundaries",
  FullRezzReviewValue
>;

const FULL_REZZ_REVIEW_FIELDS = [
  ["likeness", "Likeness"],
  ["naturalness", "Naturalness"],
  ["delivery", "Delivery"],
  ["reference_purity", "Reference purity"],
  ["canon_boundaries", "Canon boundaries"],
] as const;

const EMPTY_FULL_REZZ_REVIEW: FullRezzReviewRatings = {
  likeness: "unreviewed",
  naturalness: "unreviewed",
  delivery: "unreviewed",
  reference_purity: "unreviewed",
  canon_boundaries: "unreviewed",
};

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
  groupContinuationMode?: GroupContinuationMode;
  groupContinuationRevision?: number;
  createdAt: string;
  archivedAt?: string | null;
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
  const { t } = useTranslation(["chat", "common"]);
  const { getToken } = useAuth();
  const [showArchived, setShowArchived] = useState(false);
  const { data: convList, isLoading: loadingList } = useListOpenaiConversations({ archived: showArchived });
  const createConv = useCreateOpenaiConversation();
  const deleteConv = useDeleteOpenaiConversation();
  const archiveConv = useArchiveOpenaiConversation();
  const updateContinuation = useUpdateOpenaiConversationContinuation();
  const { data: engrams } = useListEngrams<Engram[]>();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [activeId, setActiveId] = useState<number | null>(null);
  // Keep the conversation that is actually open locally. The list query is
  // invalidated after creation and may still contain the previous snapshot when
  // the user sends the first message in a new group.
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [convMode, setConvMode] = useState<ChatMode>("companion");
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [customEngram, setCustomEngram] = useState("");
  const [selectedEngramIds, setSelectedEngramIds] = useState<number[]>([]);
  const [groupContinuationMode, setGroupContinuationMode] = useState<GroupContinuationMode>("short");
  const [groupSettingsMode, setGroupSettingsMode] = useState<GroupContinuationMode>("short");
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [convSheetOpen, setConvSheetOpen] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [sysEvents, setSysEvents] = useState<SystemEvent[]>([]);
  const [fullRezzDialogOpen, setFullRezzDialogOpen] = useState(false);
  const [fullRezzHistoryOpen, setFullRezzHistoryOpen] = useState(false);
  const [fullRezzFile, setFullRezzFile] = useState<File | null>(null);
  const [fullRezzPreview, setFullRezzPreview] = useState<FullRezzPreview | null>(null);
  const [fullRezzSelectedProfileId, setFullRezzSelectedProfileId] = useState("");
  const [fullRezzBusy, setFullRezzBusy] = useState(false);
  const [fullRezzRuntime, setFullRezzRuntime] = useState<{ available: boolean; reason?: string } | null>(null);
  const [fullRezzBoundEngramId, setFullRezzBoundEngramId] = useState<number | null>(null);
  const [speechJobs, setSpeechJobs] = useState<Record<number, SpeechJobView>>({});
  const [presenterAudioUrl, setPresenterAudioUrl] = useState<string | null>(null);
  const [movieExportSelection, setMovieExportSelection] = useState<{
    conversationId: number;
    messageId: number;
  } | null>(null);
  const [speechReviewRatings, setSpeechReviewRatings] = useState<Record<number, FullRezzReviewRatings>>({});
  const [speechReviewStatus, setSpeechReviewStatus] = useState<Record<number, string>>({});
  const [speechReviewBusy, setSpeechReviewBusy] = useState<Record<number, boolean>>({});
  const isMobile = useIsMobile();

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fullRezzFileInputRef = useRef<HTMLInputElement>(null);
  const audioObjectUrlsRef = useRef<string[]>([]);

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
      groupContinuationMode: data.groupContinuationMode ?? "short",
      groupContinuationRevision: data.groupContinuationRevision ?? 0,
      createdAt: data.createdAt,
      archivedAt: data.archivedAt ?? null,
    };
    setMessages(data.messages ?? []);
    setAttachments([]);
    setActiveId(id);
    setActiveConversation(conv);
    setConvMode((conv.mode as ChatMode) ?? "companion");
    setCustomEngram(conv.customEngram ?? "");
    setSelectedEngramIds(conv.engramIds ?? (conv.engramId != null ? [conv.engramId] : []));
    setGroupContinuationMode(conv.groupContinuationMode ?? "short");
    setConvSheetOpen(false);
    scrollToBottom();
  }, [authFetch]);

  const uploadFile = useCallback(async (file: File) => {
    const convId = activeId;
    if (!convId) return;
    setUploading(true);
    try {
      const form = new FormData();
      const mimeType = normalizeMediaUploadMimeType(file.name, file.type);
      const uploadFile =
        mimeType === file.type
          ? file
          : new File([file], file.name, { type: mimeType, lastModified: file.lastModified });
      form.append("file", uploadFile);
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
        groupContinuationMode: isGroup ? groupContinuationMode : undefined,
      },
    });
    queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
    setShowNewDialog(false);
    setNewTitle("");
    setConvSheetOpen(false);
    setActiveConversation({
      id: result.id,
      title: result.title,
      mode: result.mode,
      personaName: result.personaName,
      customEngram: result.customEngram,
      engramId: result.engramId,
      engramIds: result.engramIds ?? [],
      groupContinuationMode: result.groupContinuationMode ?? groupContinuationMode,
      groupContinuationRevision: result.groupContinuationRevision ?? 0,
      createdAt: String(result.createdAt),
      archivedAt: result.archivedAt ?? null,
    });
    await loadConversation(result.id);
  }

  function toggleEngram(id: number) {
    setSelectedEngramIds((prev) =>
      prev.includes(id) ? prev.filter((participantId) => participantId !== id) : [...prev, id],
    );
  }

  async function handleDelete(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await deleteConv.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
      if (activeId === id) {
        setActiveId(null);
        setActiveConversation(null);
        setMessages([]);
      }
      toast({ title: t("toastConversationDeleted") });
    } catch (error) {
      console.error("Conversation deletion failed", { conversationId: id, error });
      toast({
        title: t("toastDeleteFailed"),
        description: describeDeleteFailure(error, t),
        variant: "destructive",
      });
    }
  }

  async function handleArchive(id: number, archived: boolean, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      const updated = await archiveConv.mutateAsync({ id, data: { archived } });
      queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey({ archived: false }) });
      queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey({ archived: true }) });
      if (activeId === id) {
        setActiveConversation((current) => current ? { ...current, archivedAt: updated.archivedAt } : current);
      }
      toast({ title: archived ? t("toastConversationArchived") : t("toastConversationRestored") });
    } catch (error) {
      const description = error instanceof Error ? error.message : t("toastCouldNotReachApi");
      toast({ title: t("toastArchiveFailed"), description, variant: "destructive" });
    }
  }

  function openGroupSettings() {
    if (!activeConv || !isActiveGroup) return;
    setGroupSettingsMode(activeConv.groupContinuationMode ?? "short");
    setShowGroupSettings(true);
  }

  function isContinuationConflict(error: unknown): error is {
    status: number;
    data: {
      code: string;
      groupContinuationMode: GroupContinuationMode;
      groupContinuationRevision: number;
    };
  } {
    if (!error || typeof error !== "object") return false;
    const candidate = error as { status?: unknown; data?: unknown };
    if (candidate.status !== 409 || !candidate.data || typeof candidate.data !== "object") {
      return false;
    }
    const data = candidate.data as Record<string, unknown>;
    return (
      data.code === "GROUP_CONTINUATION_CONFLICT" &&
      (data.groupContinuationMode === "off" ||
        data.groupContinuationMode === "short" ||
        data.groupContinuationMode === "extended") &&
      typeof data.groupContinuationRevision === "number"
    );
  }

  async function handleSaveGroupSettings() {
    if (!activeId || !isActiveGroup) return;
    try {
      const updated = await updateContinuation.mutateAsync({
        id: activeId,
        data: {
          groupContinuationMode: groupSettingsMode,
          expectedRevision: activeConv?.groupContinuationRevision ?? 0,
        },
      });
      setGroupContinuationMode(updated.groupContinuationMode);
      setActiveConversation((current) =>
        current
          ? {
              ...current,
              groupContinuationMode: updated.groupContinuationMode,
              groupContinuationRevision: updated.groupContinuationRevision,
            }
          : current,
      );
      queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
      setShowGroupSettings(false);
      toast({ title: t("common:success"), description: t("groupContinuationLabel") });
    } catch (error) {
      if (isContinuationConflict(error)) {
        const current = error.data;
        setGroupSettingsMode(current.groupContinuationMode);
        setGroupContinuationMode(current.groupContinuationMode);
        setActiveConversation((previous) =>
          previous
            ? {
                ...previous,
                groupContinuationMode: current.groupContinuationMode,
                groupContinuationRevision: current.groupContinuationRevision,
              }
            : previous,
        );
        queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
        toast({
          title: t("common:error"),
          description: t("groupContinuationChangedElsewhere"),
          variant: "destructive",
        });
        return;
      }
      toast({
        title: t("common:error"),
        description: t("common:errorGeneric"),
        variant: "destructive",
      });
    }
  }

  function saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function handleDownload(format: "md" | "txt" | "pdf" | "docx") {
    if (!activeConv || messages.length === 0) return;

    const speakerName = (speakerEngramId?: number | null) => {
      if (speakerEngramId == null) return t("engramFallback");
      return (engrams ?? []).find((engram) => engram.id === speakerEngramId)?.name ?? t("engramFallback");
    };
    const exportedAt = new Date().toISOString();
    const entries = buildTranscriptEntries(messages, {
      you: t("you"),
      perceivedContext: t("perceivedContext"),
      engramFallback: t("engramFallback"),
      speakerName,
      defaultAssistant: activeEngram?.name ?? "PYRI",
    });
    const safeTitle = activeConv.title.trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
    const filename = safeTitle || "engram-chat";
    try {
      if (format === "md" || format === "txt") {
        const textInput = {
          title: activeConv.title,
          downloadedOn: t("downloadedOn"),
          exportedAt,
          conversationCreated: t("conversationCreated"),
          createdAt: activeConv.createdAt,
          entries,
        };
        const transcript = format === "md"
          ? buildMarkdownTranscript(textInput)
          : buildPlainTextTranscript(textInput);
        saveBlob(new Blob([transcript], { type: format === "md" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8" }), `${filename}.${format}`);
      } else if (format === "docx") {
        const children = [
          new Paragraph({ text: activeConv.title, heading: HeadingLevel.TITLE }),
          new Paragraph({ text: `${t("downloadedOn")}: ${exportedAt}` }),
          new Paragraph({ text: `${t("conversationCreated")}: ${new Date(activeConv.createdAt).toISOString() }` }),
          ...entries.flatMap((entry) => [
            new Paragraph({ text: entry.heading, heading: HeadingLevel.HEADING_2 }),
            ...(entry.timestamp ? [new Paragraph({ children: [new TextRun({ text: entry.timestamp, italics: true })] })] : []),
            new Paragraph({ text: entry.content }),
          ]),
        ];
        saveBlob(await Packer.toBlob(new Document({ sections: [{ children }] })), `${filename}.docx`);
      } else {
        const pdf = await PDFDocument.create();
        const regular = await pdf.embedFont(StandardFonts.Helvetica);
        const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
        let page = pdf.addPage([612, 792]);
        let y = 744;
        const drawLines = (text: string, size: number, font = regular, color = rgb(0.1, 0.1, 0.1)) => {
          const maxChars = Math.max(35, Math.floor(96 * (10 / size)));
          const lines = text.split(/\r?\n/).flatMap((line) => {
            if (!line) return [""];
            const words = line.split(/\s+/);
            const wrapped: string[] = [];
            let current = "";
            for (const word of words) {
              if ((current + " " + word).trim().length > maxChars && current) {
                wrapped.push(current);
                current = word;
              } else {
                current = `${current} ${word}`.trim();
              }
            }
            if (current) wrapped.push(current);
            return wrapped;
          });
          for (const line of lines) {
            if (y < 48) {
              page = pdf.addPage([612, 792]);
              y = 744;
            }
            page.drawText(line.replace(/[^\x20-\x7E]/g, "?"), { x: 48, y, size, font, color });
            y -= size + 5;
          }
          y -= 5;
        };
        drawLines(activeConv.title, 18, bold, rgb(0.05, 0.3, 0.45));
        drawLines(`${t("downloadedOn")}: ${exportedAt}`, 9);
        drawLines(`${t("conversationCreated")}: ${new Date(activeConv.createdAt).toISOString()}`, 9);
        for (const entry of entries) {
          drawLines(entry.heading, 12, bold, rgb(0.05, 0.3, 0.45));
          if (entry.timestamp) drawLines(entry.timestamp, 9);
          drawLines(entry.content, 10);
        }
        const pdfBytes = await pdf.save();
        const pdfBuffer = new ArrayBuffer(pdfBytes.byteLength);
        new Uint8Array(pdfBuffer).set(pdfBytes);
        saveBlob(new Blob([pdfBuffer], { type: "application/pdf" }), `${filename}.pdf`);
      }
      toast({ title: t("toastConversationDownloaded") });
    } catch {
      toast({ title: t("toastDownloadFailed"), variant: "destructive" });
    }
  }

  async function handleSend() {
    if (!input.trim() || streaming || !activeId) return;
    const conversationId = activeId;
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
      const resp = await authFetch(`${BASE}/api/openai/conversations/${conversationId}/messages`, {
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
      await reloadMessages(conversationId);
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
      // Group replies are persisted and appended as they arrive. Aborting a
      // group stream must leave the already-rendered human-triggered pass
      // intact; only the synthetic single-chat placeholder is disposable.
      if (!isGroup) {
        setMessages((prev) => prev.filter((_, i) => i !== assistantIdx));
      }
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

  const activeConv =
    activeConversation ?? (convList ?? []).find((c: Conversation) => c.id === activeId);
  const modeInfo = MODES.find((m) => m.id === (activeConv?.mode ?? convMode));
  const activeEngram = (engrams ?? []).find((e) => e.id === activeConv?.engramId);
  const activeGroupEngrams = (engrams ?? []).filter((e) => (activeConv?.engramIds ?? []).includes(e.id));
  const isActiveGroup = activeGroupEngrams.length >= 2;
  const engramById = new Map((engrams ?? []).map((e) => [e.id, e]));

  useEffect(() => {
    let cancelled = false;
    setFullRezzBoundEngramId(null);
    if (!activeEngram || activeEngram.isArchival) return;
    void authFetch(`${BASE}/api/full-rezz/engrams/${activeEngram.id}/binding`)
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<{ bound?: boolean; isArchival?: boolean }>;
      })
      .then((result) => {
        if (!cancelled && result?.bound && !result.isArchival) {
          setFullRezzBoundEngramId(activeEngram.id);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeEngram?.id, activeEngram?.isArchival, authFetch]);

  useEffect(
    () => () => {
      for (const objectUrl of audioObjectUrlsRef.current) URL.revokeObjectURL(objectUrl);
    },
    [],
  );

  async function openFullRezzDialog() {
    setFullRezzDialogOpen(true);
    setFullRezzFile(null);
    setFullRezzPreview(null);
    setFullRezzSelectedProfileId("");
    setFullRezzRuntime(null);
    try {
      const response = await authFetch(`${BASE}/api/full-rezz/status`);
      const value = await response.json();
      setFullRezzRuntime(value);
    } catch {
      setFullRezzRuntime({
        available: false,
        reason: "FULL_REZZ runtime status could not be reached.",
      });
    }
  }

  async function previewFullRezzFile(file: File | null) {
    setFullRezzFile(file);
    setFullRezzPreview(null);
    setFullRezzSelectedProfileId("");
    if (!file) return;
    setFullRezzBusy(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const response = await authFetch(`${BASE}/api/full-rezz/import-preview`, {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Reference-pack preview failed.");
      const profiles = Array.isArray(result.profiles) ? result.profiles as FullRezzProfileChoice[] : [];
      setFullRezzPreview({
        packId: String(result.packId ?? ""),
        schemaVersion: String(result.schemaVersion ?? ""),
        profiles,
      });
      if (profiles.length === 1) setFullRezzSelectedProfileId(profiles[0].id);
    } catch (error) {
      toast({
        title: "FULL_REZZ import preview failed",
        description: error instanceof Error ? error.message : "The pack could not be validated.",
        variant: "destructive",
      });
    } finally {
      setFullRezzBusy(false);
    }
  }

  async function importFullRezzProfile() {
    if (!activeEngram || activeEngram.isArchival || !fullRezzFile || !fullRezzSelectedProfileId) return;
    setFullRezzBusy(true);
    const form = new FormData();
    form.append("file", fullRezzFile);
    form.append("originalProfileId", fullRezzSelectedProfileId);
    try {
      const response = await authFetch(
        `${BASE}/api/full-rezz/engrams/${activeEngram.id}/import`,
        { method: "POST", body: form },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Profile import failed.");
      setFullRezzBoundEngramId(activeEngram.id);
      setFullRezzDialogOpen(false);
      toast({
        title: "FULL_REZZ profile bound",
        description: "The selected profile is linked to this writable engram. Speech stays off until you request it.",
      });
    } catch (error) {
      toast({
        title: "FULL_REZZ import failed",
        description: error instanceof Error ? error.message : "The profile could not be imported.",
        variant: "destructive",
      });
    } finally {
      setFullRezzBusy(false);
    }
  }

  async function speakSavedReply(message: Message) {
    if (!activeConv || !activeEngram || message.id == null) return;
    const current = speechJobs[message.id];
    if (current?.status === "queued" || current?.status === "running") return;
    setSpeechJobs((jobs) => ({
      ...jobs,
      [message.id!]: { jobId: "", status: "queued" },
    }));
    setSpeechReviewRatings((ratings) => ({ ...ratings, [message.id!]: EMPTY_FULL_REZZ_REVIEW }));
    setSpeechReviewStatus((status) => ({ ...status, [message.id!]: "" }));
    try {
      const response = await authFetch(
        `${BASE}/api/full-rezz/conversations/${activeConv.id}/messages/${message.id}/speech`,
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      );
      let job = await response.json();
      if (!response.ok) throw new Error(job.error ?? "Unable to start local speech.");
      setSpeechJobs((jobs) => ({
        ...jobs,
        [message.id!]: {
          jobId: job.id,
          status: job.status,
          turnId: job.turnId,
          generationIds: job.generationIds,
        },
      }));
      for (let attempt = 0; attempt < 1200; attempt += 1) {
        if (job.status !== "queued" && job.status !== "running") break;
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const statusResponse = await authFetch(`${BASE}/api/full-rezz/jobs/${job.id}`);
        const next = await statusResponse.json();
        if (!statusResponse.ok) throw new Error(next.error ?? "Could not read speech-job status.");
        job = next;
        setSpeechJobs((jobs) => ({
          ...jobs,
          [message.id!]: {
            jobId: job.id,
            status: job.status,
            error: job.error,
            turnId: job.turnId,
            audioUrl: job.audioUrl,
            generationIds: job.generationIds,
          },
        }));
      }
      if (job.status === "succeeded" && typeof job.audioUrl === "string") {
        const audioResponse = await authFetch(`${BASE}${job.audioUrl}`);
        if (!audioResponse.ok) throw new Error("Completed audio could not be loaded.");
        const blob = await audioResponse.blob();
        const objectUrl = URL.createObjectURL(new Blob([blob], { type: "audio/wav" }));
        audioObjectUrlsRef.current.push(objectUrl);
        setSpeechJobs((jobs) => ({
          ...jobs,
          [message.id!]: {
            jobId: job.id,
            status: "succeeded",
            turnId: job.turnId,
            audioUrl: job.audioUrl,
            audioObjectUrl: objectUrl,
            generationIds: job.generationIds,
          },
        }));
      } else if (job.status === "failed" || job.status === "cancelled") {
        setSpeechJobs((jobs) => ({
          ...jobs,
          [message.id!]: {
            jobId: job.id,
            status: job.status,
            turnId: job.turnId,
            error: job.error,
            generationIds: job.generationIds,
          },
        }));
      }
    } catch (error) {
      setSpeechJobs((jobs) => ({
        ...jobs,
        [message.id!]: {
          jobId: current?.jobId ?? "",
          status: "failed",
          error: error instanceof Error ? error.message : "FULL_REZZ speech failed.",
        },
      }));
      toast({
        title: "FULL_REZZ speech failed",
        description: error instanceof Error ? error.message : "The local voice worker did not finish.",
        variant: "destructive",
      });
    }
  }

  async function cancelSavedReplySpeech(messageId: number) {
    const job = speechJobs[messageId];
    if (!job?.jobId) return;
    try {
      await authFetch(`${BASE}/api/full-rezz/jobs/${job.jobId}`, { method: "DELETE" });
      setSpeechJobs((jobs) => ({
        ...jobs,
        [messageId]: { ...job, status: "cancelled", error: "Speech job cancelled." },
      }));
    } catch {
      toast({ title: "Could not cancel FULL_REZZ speech", variant: "destructive" });
    }
  }

  function updateSpeechReviewRating(
    messageId: number,
    field: keyof FullRezzReviewRatings,
    value: FullRezzReviewValue,
  ) {
    setSpeechReviewRatings((current) => ({
      ...current,
      [messageId]: {
        ...(current[messageId] ?? EMPTY_FULL_REZZ_REVIEW),
        [field]: value,
      },
    }));
    setSpeechReviewStatus((current) => ({ ...current, [messageId]: "" }));
  }

  async function saveSpeechReview(messageId: number) {
    const job = speechJobs[messageId];
    const generationIds = job?.generationIds;
    const ratings = speechReviewRatings[messageId] ?? EMPTY_FULL_REZZ_REVIEW;
    if (!job?.jobId || !generationIds?.length) return;
    if (Object.values(ratings).some((value) => value === "unreviewed")) {
      setSpeechReviewStatus((current) => ({
        ...current,
        [messageId]: "Rate all five dimensions before saving.",
      }));
      return;
    }

    setSpeechReviewBusy((current) => ({ ...current, [messageId]: true }));
    setSpeechReviewStatus((current) => ({ ...current, [messageId]: "Saving review…" }));
    try {
      for (const generationId of generationIds) {
        const response = await authFetch(
          `${BASE}/api/full-rezz/jobs/${job.jobId}/review`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ generationId, ratings }),
          },
        );
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error ?? "The listening review could not be saved.");
        }
      }
      setSpeechReviewStatus((current) => ({
        ...current,
        [messageId]: `Review saved for ${generationIds.length} generated segment${generationIds.length === 1 ? "" : "s"}.`,
      }));
    } catch (error) {
      setSpeechReviewStatus((current) => ({
        ...current,
        [messageId]: error instanceof Error ? error.message : "The listening review could not be saved.",
      }));
    } finally {
      setSpeechReviewBusy((current) => ({ ...current, [messageId]: false }));
    }
  }

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
      const described = describeSystemEvent(ev, t);
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
            <h2 className="font-mono text-xs uppercase tracking-widest text-primary">{showArchived ? t("archivedConversations") : t("conversations")}</h2>
            <p className="font-mono text-[9px] text-muted-foreground/50 mt-0.5">{t("lpemDialogueInterface")}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowArchived((current) => !current)}
              className="w-7 h-7 flex items-center justify-center text-muted-foreground/60 hover:text-primary transition-colors"
              title={showArchived ? t("showActiveConversations") : t("showArchivedConversations")}
              aria-label={showArchived ? t("showActiveConversations") : t("showArchivedConversations")}
            >
              {showArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
            </button>
            {!showArchived && <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
            <DialogTrigger asChild>
               <Button
                 size="icon"
                 variant="ghost"
                 className="w-7 h-7 text-primary hover:bg-primary/10"
                 onClick={() => {
                   setSelectedEngramIds([]);
                    setGroupContinuationMode("short");
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
                      {(engrams ?? []).filter((e) => !e.isArchival).map((e) => {
                        const eligibility = e.continuationEligibility;
                        return (
                          <div key={e.id} className="contents">
                            <button
                              onClick={() => toggleEngram(e.id)}
                              className={`flex items-center gap-2 px-2.5 py-2 border font-mono text-xs transition-colors ${selectedEngramIds.includes(e.id) ? "border-primary/50 bg-primary/10 text-primary" : "border-border/30 text-muted-foreground hover:border-primary/30 hover:text-foreground"}`}
                            >
                              <span>{e.symbol}</span>
                              <span className="uppercase tracking-wider text-[10px]">{e.name}</span>
                            </button>
                            <div className="col-span-2 -mt-1 px-2.5 pb-1 font-mono text-[9px] leading-relaxed">
                              <span className={eligibility?.eligible ? "text-emerald-400/80" : "text-amber-300/80"}>
                                {eligibility
                                  ? eligibility.eligible
                                    ? t("groupContinuationAvailable")
                                    : t("groupContinuationBlocked")
                                  : t("groupContinuationStatusUnknown")}
                              </span>
                              {eligibility && !eligibility.eligible && (
                                <span className="ml-1 text-muted-foreground/60">
                                  — {continuationReasonLabel(eligibility.reason, t)}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="font-mono text-[9px] text-muted-foreground/50 mt-1">
                      {selectedEngramIds.length >= 2
                        ? t("groupChatHint", { count: selectedEngramIds.length })
                        : t("talkToHint")}
                    </p>
                    <p className="font-mono text-[9px] leading-relaxed text-muted-foreground/50 mt-1">
                      {t("groupContinuationEligibilityNote")}
                    </p>
                    {selectedEngramIds.length >= 2 && (
                      <>
                        <div className="mt-2 border border-primary/20 bg-primary/5 px-2.5 py-2 font-mono text-[9px] leading-relaxed text-primary/70">
                          {t("groupConsentNotice")}
                        </div>
                        <div className="mt-3">
                          <label className="font-mono text-[10px] uppercase text-muted-foreground tracking-wider mb-1 block">
                            {t("groupContinuationLabel")}
                          </label>
                          <p className="font-mono text-[9px] leading-relaxed text-muted-foreground/60 mb-2">
                            {t("groupContinuationDescription")}
                          </p>
                          <div className="grid grid-cols-3 gap-1.5">
                            {(["off", "short", "extended"] as const).map((mode) => {
                              const labelKey = `groupContinuation${mode[0].toUpperCase()}${mode.slice(1)}` as const;
                              return (
                                <button
                                  key={mode}
                                  type="button"
                                  onClick={() => setGroupContinuationMode(mode)}
                                  className={`border px-2 py-2 text-left font-mono transition-colors ${
                                    groupContinuationMode === mode
                                      ? "border-primary/50 bg-primary/10 text-primary"
                                      : "border-border/30 text-muted-foreground hover:border-primary/30 hover:text-foreground"
                                  }`}
                                >
                                  <span className="block text-[10px] uppercase tracking-wider">{t(labelKey)}</span>
                                  <span className="mt-0.5 block text-[9px] opacity-60">{t(`${labelKey}Hint`)}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </>
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
            </Dialog>}
          </div>
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
                    data-testid="conversation-row"
                    data-conversation-id={c.id}
                    className={`w-full text-left px-3 py-2.5 border-l-2 transition-all group flex items-start gap-2 ${activeId === c.id ? "border-primary bg-primary/10" : "border-transparent hover:bg-white/5 hover:border-white/20"}`}
                  >
                    <button
                      type="button"
                      data-testid="select-conversation"
                      onClick={() => loadConversation(c.id)}
                      className="flex min-w-0 flex-1 items-start gap-2 text-left touch-manipulation"
                    >
                      <span className="text-primary/60 text-sm mt-0.5">{modeGlyph}</span>
                      <span className="min-w-0 flex-1">
                        <span data-testid="conversation-title" className={`block font-mono text-xs truncate ${activeId === c.id ? "text-primary" : "text-foreground/80"}`}>{c.title}</span>
                        <span className="block font-mono text-[9px] text-muted-foreground/50 uppercase mt-0.5 truncate">
                          {modeLabel}{listEngram?.isArchival ? ` · ${t("common:archivalBadge")}` : ""}
                        </span>
                      </span>
                    </button>
                    {!listEngram?.isArchival && <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={(e) => handleArchive(c.id, !showArchived, e)}
                        className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-sm text-muted-foreground/70 transition-opacity hover:text-primary md:opacity-0 md:group-hover:opacity-100 touch-manipulation"
                        title={showArchived ? t("restoreConversation") : t("archiveConversation")}
                        aria-label={showArchived ? t("restoreConversation") : t("archiveConversation")}
                      >
                        {showArchived ? <ArchiveRestore className="w-3 h-3" /> : <Archive className="w-3 h-3" />}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDelete(c.id, e)}
                        className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-sm text-muted-foreground/70 transition-opacity hover:text-rose-400 md:opacity-0 md:group-hover:opacity-100 touch-manipulation"
                        title={t("deleteConversation")}
                        aria-label={t("deleteConversation")}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>}
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
      <Dialog open={showGroupSettings} onOpenChange={setShowGroupSettings}>
        <DialogContent className="bg-card border-border/50 max-w-sm w-[calc(100vw-2rem)]">
          <DialogHeader>
            <DialogTitle className="font-display tracking-widest text-primary">
              {t("groupContinuationLabel")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <p className="font-mono text-[10px] leading-relaxed text-muted-foreground/70">
              {t("groupContinuationDescription")}
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {(["off", "short", "extended"] as const).map((mode) => {
                const labelKey = `groupContinuation${mode[0].toUpperCase()}${mode.slice(1)}` as const;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setGroupSettingsMode(mode)}
                    className={`border px-2 py-2 text-left font-mono transition-colors ${
                      groupSettingsMode === mode
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "border-border/30 text-muted-foreground hover:border-primary/30 hover:text-foreground"
                    }`}
                  >
                    <span className="block text-[10px] uppercase tracking-wider">{t(labelKey)}</span>
                    <span className="mt-0.5 block text-[9px] opacity-60">{t(`${labelKey}Hint`)}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowGroupSettings(false)}
                disabled={updateContinuation.isPending}
              >
                {t("common:cancel")}
              </Button>
              <Button
                type="button"
                onClick={() => void handleSaveGroupSettings()}
                disabled={updateContinuation.isPending}
              >
                {t("common:save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={fullRezzDialogOpen} onOpenChange={setFullRezzDialogOpen}>
        <DialogContent className="bg-card border-border/50 max-w-lg w-[calc(100vw-2rem)]">
          <DialogHeader>
            <DialogTitle className="font-display tracking-widest text-primary">
              FULL_REZZ 3.0 · Local voice profile
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="font-mono text-[10px] leading-relaxed text-muted-foreground/80">
              Bind an explicitly selected profile to {activeEngram?.name ?? "this writable engram"}.
              The import preserves its source snapshot and ID mapping; authored prompts stay inert.
              Speech is synthetic, not a claim of performer identity.
            </p>
            {fullRezzRuntime && (
              <div className={`border px-3 py-2 font-mono text-[10px] ${
                fullRezzRuntime.available
                  ? "border-emerald-400/30 bg-emerald-400/5 text-emerald-300"
                  : "border-amber-400/30 bg-amber-400/5 text-amber-200"
              }`}>
                {fullRezzRuntime.available
                  ? "Local runtime staged. Model hashes are verified on first speech job."
                  : fullRezzRuntime.reason ?? "Local runtime unavailable."}
              </div>
            )}
            {fullRezzBoundEngramId === activeEngram?.id && (
              <div className="border border-primary/30 bg-primary/5 px-3 py-2 font-mono text-[10px] text-primary/80">
                A FULL_REZZ profile is already bound. Importing another profile replaces only that binding.
              </div>
            )}
            <input
              ref={fullRezzFileInputRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(event) => void previewFullRezzFile(event.target.files?.[0] ?? null)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => fullRezzFileInputRef.current?.click()}
                disabled={fullRezzBusy || !fullRezzRuntime?.available}
              >
                {fullRezzBusy && !fullRezzPreview
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Upload className="w-3.5 h-3.5" />}
                Choose reference-pack ZIP
              </Button>
              {fullRezzFile && (
                <span className="max-w-[16rem] truncate font-mono text-[10px] text-muted-foreground">
                  {fullRezzFile.name}
                </span>
              )}
            </div>
            {fullRezzPreview && (
              <div className="space-y-2 border border-border/40 p-3">
                <div className="font-mono text-[10px] text-muted-foreground">
                  Pack {fullRezzPreview.packId} · schema {fullRezzPreview.schemaVersion}
                </div>
                {fullRezzPreview.profiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    aria-pressed={fullRezzSelectedProfileId === profile.id}
                    onClick={() => setFullRezzSelectedProfileId(profile.id)}
                    className={`w-full border px-3 py-2 text-left ${
                      fullRezzSelectedProfileId === profile.id
                        ? "border-primary/60 bg-primary/10"
                        : "border-border/40 hover:border-primary/30"
                    }`}
                  >
                    <span className="block font-mono text-xs text-foreground">{profile.name}</span>
                    <span className="mt-1 block font-mono text-[9px] text-muted-foreground">
                      {profile.id} · {profile.referenceCount} references · {profile.sourceCount} sources
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setFullRezzDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void importFullRezzProfile()}
                disabled={
                  fullRezzBusy ||
                  !fullRezzRuntime?.available ||
                  !fullRezzFile ||
                  !fullRezzSelectedProfileId ||
                  !activeEngram ||
                  activeEngram.isArchival
                }
              >
                {fullRezzBusy && fullRezzPreview
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : null}
                Bind selected profile
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
                {isActiveGroup && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="w-7 h-7 text-muted-foreground/60 hover:text-primary"
                    onClick={openGroupSettings}
                    disabled={streaming}
                    title={t("groupContinuationLabel")}
                    aria-label={t("groupContinuationLabel")}
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                  </Button>
                )}
                {activeEngram && !activeEngram.isArchival && !activeConv.archivedAt && !isActiveGroup && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className={`w-7 h-7 ${
                      fullRezzBoundEngramId === activeEngram.id
                        ? "text-primary hover:text-primary"
                        : "text-muted-foreground/60 hover:text-primary"
                    }`}
                    onClick={() => void openFullRezzDialog()}
                    title="FULL_REZZ local voice profile"
                    aria-label="FULL_REZZ local voice profile"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                  </Button>
                )}
                {activeEngram &&
                  !activeEngram.isArchival &&
                  !activeConv.archivedAt &&
                  !isActiveGroup &&
                  fullRezzBoundEngramId === activeEngram.id && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="w-7 h-7 text-primary/80 hover:text-primary"
                      onClick={() => setFullRezzHistoryOpen(true)}
                      title="FULL_REZZ conversation history"
                      aria-label="FULL_REZZ conversation history"
                    >
                      <History className="w-3.5 h-3.5" />
                    </Button>
                  )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="w-7 h-7 text-muted-foreground/60 hover:text-primary"
                      disabled={messages.length === 0 || streaming}
                      title={t("downloadConversation")}
                      aria-label={t("downloadConversation")}
                    >
                      <Download className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="font-mono text-xs">
                    <DropdownMenuItem onSelect={() => void handleDownload("md")}>{t("downloadMarkdown")}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void handleDownload("txt")}>{t("downloadText")}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void handleDownload("pdf")}>{t("downloadPdf")}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void handleDownload("docx")}>{t("downloadDocx")}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                {activeConv.archivedAt && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="w-7 h-7 text-primary/70 hover:text-primary"
                    onClick={(event) => handleArchive(activeConv.id, false, event)}
                    title={t("restoreConversation")}
                    aria-label={t("restoreConversation")}
                  >
                    <ArchiveRestore className="w-3.5 h-3.5" />
                  </Button>
                )}
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
              const speechJob = msg.id == null ? undefined : speechJobs[msg.id];
              const canSpeakSavedReply =
                msg.role === "assistant" &&
                msg.id != null &&
                fullRezzBoundEngramId != null &&
                msg.speakerEngramId === fullRezzBoundEngramId &&
                !activeConv?.archivedAt &&
                !activeEngram?.isArchival;
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
                    {canSpeakSavedReply && (
                      <div className="mt-2 space-y-2">
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 font-mono text-[9px] uppercase tracking-wider"
                            onClick={() => void speakSavedReply(msg)}
                            disabled={speechJob?.status === "queued" || speechJob?.status === "running"}
                          >
                            {speechJob?.status === "queued" || speechJob?.status === "running"
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Volume2 className="w-3 h-3" />}
                            {speechJob?.status === "succeeded" ? "Regenerate speech" : "Speak saved reply"}
                          </Button>
                          {(speechJob?.status === "queued" || speechJob?.status === "running") && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 font-mono text-[9px] text-muted-foreground"
                              onClick={() => void cancelSavedReplySpeech(msg.id!)}
                            >
                              <X className="w-3 h-3" />
                              Cancel
                            </Button>
                          )}
                        </div>
                        {speechJob?.audioObjectUrl && (
                          <div className="space-y-1">
                            <audio controls preload="none" src={speechJob.audioObjectUrl} className="h-9 max-w-full" />
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 font-mono text-[9px] uppercase tracking-wider"
                              onClick={() => setPresenterAudioUrl(speechJob.audioObjectUrl!)}
                            >
                              Open Studio Unit presenter
                            </Button>
                            {speechJob.status === "succeeded" &&
                              activeConv &&
                              msg.id != null &&
                              fullRezzBoundEngramId === activeEngram?.id && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="ml-2 h-7 font-mono text-[9px] uppercase tracking-wider"
                                  onClick={() =>
                                    setMovieExportSelection({
                                      conversationId: activeConv.id,
                                      messageId: msg.id!,
                                    })
                                  }
                                  title="Export an audited 60, 120 or 240 fps .webm movie"
                                >
                                  <Clapperboard className="mr-1 h-3 w-3" />
                                  Export movie
                                </Button>
                              )}
                            <p className="font-mono text-[9px] text-muted-foreground/70">
                              Synthetic offline voice · human listening review required · not a performer identity claim.
                            </p>
                          </div>
                        )}
                        {speechJob?.status === "succeeded" && (speechJob.generationIds?.length ?? 0) > 0 && msg.id != null && (
                          <div className="rounded border border-border/50 bg-background/40 p-3 space-y-3">
                            <div>
                              <p className="font-mono text-[10px] uppercase tracking-wider text-foreground/80">
                                Listening review
                              </p>
                              <p className="font-mono text-[9px] text-muted-foreground/70">
                                Apply ratings to all {speechJob.generationIds!.length} generated segment{speechJob.generationIds!.length === 1 ? "" : "s"} in this reply.
                              </p>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {FULL_REZZ_REVIEW_FIELDS.map(([field, label]) => (
                                <label key={field} className="flex items-center justify-between gap-2 font-mono text-[9px] text-muted-foreground">
                                  <span>{label}</span>
                                  <select
                                    aria-label={`FULL_REZZ ${label} review`}
                                    className="h-7 min-w-32 rounded border border-border/60 bg-background px-2 text-foreground"
                                    value={(speechReviewRatings[msg.id!] ?? EMPTY_FULL_REZZ_REVIEW)[field]}
                                    onChange={(event) =>
                                      updateSpeechReviewRating(
                                        msg.id!,
                                        field,
                                        event.target.value as FullRezzReviewValue,
                                      )
                                    }
                                  >
                                    <option value="unreviewed">Unreviewed</option>
                                    <option value="acceptable">Acceptable</option>
                                    <option value="needs_revision">Needs revision</option>
                                  </select>
                                </label>
                              ))}
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 font-mono text-[9px] uppercase tracking-wider"
                                disabled={
                                  speechReviewBusy[msg.id!] === true ||
                                  Object.values(speechReviewRatings[msg.id!] ?? EMPTY_FULL_REZZ_REVIEW)
                                    .some((value) => value === "unreviewed")
                                }
                                onClick={() => void saveSpeechReview(msg.id!)}
                              >
                                {speechReviewBusy[msg.id!] ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                                Save listening review
                              </Button>
                              {speechReviewStatus[msg.id!] && (
                                <span role="status" className="font-mono text-[9px] text-muted-foreground">
                                  {speechReviewStatus[msg.id!]}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                        {speechJob?.error && (
                          <p role="status" className="font-mono text-[9px] text-rose-300/90">
                            {speechJob.error}
                          </p>
                        )}
                      </div>
                    )}
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
              disabled={!activeId || streaming || Boolean(activeConv?.archivedAt)}
              className="flex-1 font-mono text-sm border-border/50 bg-card/30 resize-none min-h-[44px] max-h-32 py-3 placeholder:text-muted-foreground/30"
              rows={1}
            />
            {streaming ? (
              <Button
                size="icon"
                variant="outline"
                className="shrink-0 border-rose-500/40 text-rose-400 hover:bg-rose-500/10 h-11 w-11"
                onClick={() => abortRef.current?.abort()}
                title={isActiveGroup ? t("stopGroupContinuation") : t("stopGeneration")}
                aria-label={isActiveGroup ? t("stopGroupContinuation") : t("stopGeneration")}
              >
                <X className="w-4 h-4" />
              </Button>
            ) : (
              <Button
                size="icon"
                disabled={!activeId || !input.trim() || Boolean(activeConv?.archivedAt)}
                onClick={handleSend}
                className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 h-11 w-11"
              >
                <Send className="w-4 h-4" />
              </Button>
            )}
          </div>
          <p className="font-mono text-[9px] text-muted-foreground/30 text-center mt-2">
            {activeConv?.archivedAt ? t("archivedConversationReadOnly") : t("inputHint", {
              name: isActiveGroup
                ? activeGroupEngrams.map((e) => e.name).join(", ")
                : activeEngram ? activeEngram.name : "PYRI",
            })}
          </p>
        </div>
      </div>
      <FullRezzPresenter
        open={presenterAudioUrl !== null}
        onClose={() => setPresenterAudioUrl(null)}
        audioUrl={presenterAudioUrl}
        assetBaseUrl={`${BASE}/api/full-rezz/studio-unit/assets`}
        authFetch={authFetch}
      />
      <FullRezzHistoryDialog
        open={
          fullRezzHistoryOpen &&
          activeEngram != null &&
          !activeEngram.isArchival &&
          fullRezzBoundEngramId === activeEngram.id
        }
        onOpenChange={setFullRezzHistoryOpen}
        authFetch={authFetch}
        engramId={activeEngram?.id ?? 0}
        engramName={activeEngram?.name ?? "engram"}
      />
      <FullRezzMovieExportDialog
        open={movieExportSelection !== null}
        onOpenChange={(open) => {
          if (!open) setMovieExportSelection(null);
        }}
        authFetch={authFetch}
        conversationId={movieExportSelection?.conversationId ?? null}
        messageId={movieExportSelection?.messageId ?? null}
      />
    </div>
  );
}
