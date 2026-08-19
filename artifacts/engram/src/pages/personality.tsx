import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useGetPersonality, useUpdatePersonality, getGetPersonalityQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Save, RefreshCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const TRAITS = [
  { key: "curiosity" },
  { key: "stoicism" },
  { key: "empathy" },
  { key: "skepticism" },
  { key: "precision" },
  { key: "creativity" },
  { key: "initiative" },
  { key: "formality" },
  { key: "humor" },
] as const;

type TraitKey = (typeof TRAITS)[number]["key"];

export default function Personality() {
  const { t } = useTranslation("personality");
  const { data: personality, isLoading } = useGetPersonality();
  const update = useUpdatePersonality();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [traits, setTraits] = useState<Record<TraitKey, number>>({} as Record<TraitKey, number>);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (personality) {
      const t: Record<string, number> = {};
      TRAITS.forEach(tr => { t[tr.key] = (personality as any)[tr.key] ?? 0; });
      setTraits(t as Record<TraitKey, number>);
      setDirty(false);
    }
  }, [personality]);

  function handleChange(key: TraitKey, val: number[]) {
    setTraits(prev => ({ ...prev, [key]: val[0] }));
    setDirty(true);
  }

  function handleSave() {
    update.mutate({ data: traits }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetPersonalityQueryKey() });
        setDirty(false);
        toast({ title: t("updatedTitle"), description: t("updatedDescription") });
      }
    });
  }

  function handleReset() {
    if (personality) {
      const t: Record<string, number> = {};
      TRAITS.forEach(tr => { t[tr.key] = (personality as any)[tr.key] ?? 0; });
      setTraits(t as Record<TraitKey, number>);
      setDirty(false);
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-widest text-primary">{t("title")}</h2>
          <p className="text-sm font-mono text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          {dirty && (
            <Button variant="outline" size="sm" onClick={handleReset} className="font-mono text-xs uppercase tracking-wider border-border/50">
              <RefreshCcw className="w-3 h-3 mr-2" /> {t("reset")}
            </Button>
          )}
          <Button size="sm" onClick={handleSave} disabled={!dirty || update.isPending}
            className="font-mono text-xs uppercase tracking-wider bg-primary text-primary-foreground hover:bg-primary/90" data-testid="button-save-personality">
            <Save className="w-3 h-3 mr-2" /> {update.isPending ? t("saving") : t("saveTraits")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Radar visual */}
        <Card className="bg-card/40 border-border/50 backdrop-blur-sm col-span-1 flex items-center justify-center p-6 sm:p-8">
          <div className="relative flex items-center justify-center">
            <RadarViz traits={traits} loading={isLoading} />
          </div>
        </Card>

        {/* Trait sliders */}
        <div className="col-span-1 lg:col-span-2 space-y-3">
          {isLoading ? (
            Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full bg-primary/5" />
            ))
          ) : (
            TRAITS.map(tr => (
              <Card key={tr.key} className="bg-card/40 border-border/50 backdrop-blur-sm hover:bg-card/60 transition-colors" data-testid={`card-trait-${tr.key}`}>
                <CardContent className="p-4">
                  <div className="flex justify-between items-center mb-3">
                    <div>
                      <span className="font-display font-semibold uppercase tracking-widest text-sm text-foreground">{t(`traits.${tr.key}`)}</span>
                      <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{t(`traits.${tr.key}Desc`)}</p>
                    </div>
                    <span className="font-mono text-lg font-bold text-primary tabular-nums w-12 text-right">
                      {((traits[tr.key] ?? 0) * 100).toFixed(0)}
                    </span>
                  </div>
                  <Slider
                    min={0} max={1} step={0.01}
                    value={[traits[tr.key] ?? 0]}
                    onValueChange={(v) => handleChange(tr.key, v)}
                    className="w-full"
                    data-testid={`slider-trait-${tr.key}`}
                  />
                  <div className="flex justify-between mt-1 text-[9px] font-mono text-muted-foreground/50">
                    <span>{t("scale.suppressed")}</span><span>{t("scale.calibrated")}</span><span>{t("scale.dominant")}</span>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function RadarViz({ traits, loading }: { traits: Record<string, number>; loading: boolean }) {
  if (loading) return <Skeleton className="w-56 h-56 rounded-full bg-primary/5" />;
  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const R = 80;
  const keys = TRAITS.map(t => t.key);
  const n = keys.length;
  const angle = (i: number) => (i * 2 * Math.PI) / n - Math.PI / 2;
  const pt = (i: number, r: number) => ({
    x: cx + r * Math.cos(angle(i)),
    y: cy + r * Math.sin(angle(i)),
  });
  const rings = [0.25, 0.5, 0.75, 1];
  const points = keys.map((k, i) => {
    const v = (traits[k] ?? 0) * R;
    return pt(i, v);
  });
  const polyPoints = points.map(p => `${p.x},${p.y}`).join(" ");
  return (
    <svg width={size} height={size} className="overflow-visible">
      {rings.map(r => (
        <polygon
          key={r}
          points={keys.map((_, i) => { const p = pt(i, r * R); return `${p.x},${p.y}`; }).join(" ")}
          fill="none"
          stroke="hsl(190 90% 50% / 0.1)"
          strokeWidth="1"
        />
      ))}
      {keys.map((_, i) => {
        const end = pt(i, R);
        return <line key={i} x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="hsl(190 90% 50% / 0.15)" strokeWidth="1" />;
      })}
      <polygon points={polyPoints} fill="hsl(190 90% 50% / 0.15)" stroke="hsl(190 90% 50%)" strokeWidth="1.5" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill="hsl(190 90% 50%)" />
      ))}
      {keys.map((k, i) => {
        const lp = pt(i, R + 18);
        return (
          <text key={k} x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle"
            fontSize="7" fill="hsl(210 30% 60%)" fontFamily="JetBrains Mono, monospace" textLength={undefined}>
            {k.toUpperCase().slice(0, 4)}
          </text>
        );
      })}
    </svg>
  );
}
