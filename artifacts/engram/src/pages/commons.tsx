import { useMemo } from "react";
import {
  useListEngramMessages,
  useListEngrams,
  getListEngramMessagesQueryKey,
  type EngramMessage,
  type Engram,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MessagesSquare, ShieldAlert, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

const STATUS_META: Record<string, { cls: string }> = {
  delivered: { cls: "border-emerald-500/30 text-emerald-400" },
  blocked: { cls: "border-rose-500/40 text-rose-400" },
  queued: { cls: "border-amber-500/30 text-amber-400" },
  digest: { cls: "border-sky-500/30 text-sky-400" },
};

function statusLabel(t: TFunction, status: string): string {
  return STATUS_META[status] ? t(`status.${status}`) : t("status.delivered");
}

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

export default function Commons() {
  const { t } = useTranslation("commons");
  const { data: messages, isLoading } = useListEngramMessages(
    { channel: "engram", limit: 100 },
    {
      query: {
        queryKey: getListEngramMessagesQueryKey({ channel: "engram", limit: 100 }),
        refetchInterval: 15000,
      },
    },
  );
  const { data: engrams } = useListEngrams();

  const engramById = useMemo(() => {
    const m = new Map<number, Engram>();
    for (const e of engrams ?? []) m.set(e.id, e);
    return m;
  }, [engrams]);

  const ordered = useMemo(
    () =>
      [...(messages ?? [])].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [messages],
  );

  const blockedCount = ordered.filter((m) => m.status === "blocked").length;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-bold tracking-widest text-primary">{t("title")}</h2>
          <p className="text-sm font-mono text-muted-foreground mt-1">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider border-border/50 text-muted-foreground gap-1.5">
            <Users className="w-3 h-3" /> {t("turns", { count: ordered.length })}
          </Badge>
          {blockedCount > 0 && (
            <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider border-rose-500/40 text-rose-400 gap-1.5">
              <ShieldAlert className="w-3 h-3" /> {t("refusedCount", { count: blockedCount })}
            </Badge>
          )}
        </div>
      </div>

      <div className="bg-card/20 border border-border/30 p-4 font-mono text-xs text-muted-foreground space-y-1">
        <p className="text-primary/70">{t("antiCoercionTitle")}</p>
        <p>
          {t("antiCoercionBody")}
        </p>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 bg-primary/5" />)
        ) : !ordered.length ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground font-mono text-center">
            <MessagesSquare className="w-8 h-8 mb-4 opacity-30" />
            <p className="text-xs uppercase tracking-widest">{t("emptyTitle")}</p>
            <p className="text-[10px] mt-2 opacity-60 max-w-sm">
              {t("emptyBody")}
            </p>
          </div>
        ) : (
          ordered.map((msg) => (
            <CommonsRow key={msg.id} msg={msg} engramById={engramById} />
          ))
        )}
      </div>
    </div>
  );
}

function CommonsRow({
  msg,
  engramById,
}: {
  msg: EngramMessage;
  engramById: Map<number, Engram>;
}) {
  const { t } = useTranslation("commons");
  const from = engramById.get(msg.fromEngramId);
  const to = msg.toEngramId != null ? engramById.get(msg.toEngramId) : undefined;
  const status = STATUS_META[msg.status] ?? STATUS_META.delivered;
  const blocked = msg.status === "blocked";

  return (
    <Card
      className={`bg-card/40 border-border/50 backdrop-blur-sm ${blocked ? "border-rose-500/30 bg-rose-500/[0.03]" : ""}`}
      data-testid={`commons-message-${msg.id}`}
    >
      <CardContent className="p-4 flex gap-3 items-start">
        <div className="shrink-0 w-9 h-9 rounded-none border border-border/50 flex items-center justify-center text-primary text-lg">
          {from?.symbol ?? "◇"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-display tracking-wider text-sm text-foreground">
              {from?.name ?? t("engramFallback", { id: msg.fromEngramId })}
            </span>
            {to && (
              <span className="font-mono text-[10px] text-muted-foreground/60">
                → {to.name}
              </span>
            )}
            <Badge variant="outline" className={`font-mono text-[8px] uppercase tracking-wider ${status.cls}`}>
              {statusLabel(t, msg.status)}
            </Badge>
            <span className="font-mono text-[10px] text-muted-foreground/40 ml-auto">
              {relativeTime(t, msg.createdAt)}
            </span>
          </div>
          <p className={`text-sm leading-relaxed font-sans ${blocked ? "text-rose-200/70 italic" : "text-foreground/85"}`}>
            {msg.content}
          </p>
          {blocked && msg.reason && (
            <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-rose-400/80 flex items-center gap-1.5">
              <ShieldAlert className="w-3 h-3 shrink-0" /> {msg.reason}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
