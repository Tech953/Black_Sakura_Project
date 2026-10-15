import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useListHieroSymbols, useListExpressions } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

const VALENCE_COLORS: Record<string, string> = {
  Positive: "text-emerald-400 border-emerald-400/40",
  Neutral: "text-sky-400 border-sky-400/40",
  Negative: "text-rose-400 border-rose-400/40",
};

const AROUSAL_BARS: Record<string, number> = { Low: 1, Medium: 2, High: 3 };

export default function HieroCode() {
  const { t } = useTranslation("hieroCode");
  const { data: symbols, isLoading } = useListHieroSymbols();
  const { data: expressions, isLoading: exprLoading } = useListExpressions();
  const [selected, setSelected] = useState<number[]>([]);
  const [valenceFilter, setValenceFilter] = useState<string>("All");
  const [arousalFilter, setArousalFilter] = useState<string>("All");

  function toggleSymbol(id: number) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 3 ? [...prev, id] : prev);
  }

  const selectedSymbols = symbols?.filter(s => selected.includes(s.id)) ?? [];
  const compound = selectedSymbols.map(s => s.glyph).join(" + ");
  const compoundMeaning = selectedSymbols.map(s => s.name.toLowerCase()).join(" shaped by ");

  const filteredExpressions = (expressions ?? []).filter(e =>
    (valenceFilter === "All" || e.valence === valenceFilter) &&
    (arousalFilter === "All" || e.arousal === arousalFilter)
  );

  const CATEGORY_COLORS: Record<string, string> = {
    Foundation: "text-violet-400",
    Process: "text-amber-400",
    Relational: "text-emerald-400",
    Epistemic: "text-sky-400",
    Volitional: "text-rose-400",
    Cognitive: "text-cyan-400",
    Metacognitive: "text-indigo-400",
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div>
        <h2 className="text-3xl font-bold tracking-widest text-primary">{t("title")}</h2>
        <p className="text-sm font-mono text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Symbol reference */}
        <div className="space-y-3">
          <p className="font-mono text-xs text-muted-foreground/70 uppercase tracking-widest">{t("primaryGlyphs")}</p>
          {isLoading ? (
            Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-20 bg-primary/5" />)
          ) : (
            symbols?.map(s => {
              const isSelected = selected.includes(s.id);
              const catColor = CATEGORY_COLORS[s.category] ?? "text-primary";
              return (
                <Card key={s.id}
                  onClick={() => toggleSymbol(s.id)}
                  className={`cursor-pointer border transition-all duration-200 bg-card/40 backdrop-blur-sm ${isSelected ? "border-primary bg-primary/5" : "border-border/30 hover:border-border/60"}`}
                  data-testid={`card-symbol-${s.id}`}>
                  <CardContent className="p-4 flex items-start gap-4">
                    <span className={`text-4xl leading-none shrink-0 ${catColor}`}>{s.glyph}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`font-display font-bold uppercase tracking-widest text-base ${catColor}`}>{s.name}</span>
                        <Badge variant="outline" className={`font-mono text-[9px] uppercase border-current ${catColor}`}>{s.category}</Badge>
                        {isSelected && <span className="font-mono text-[9px] text-primary uppercase">{t("selected")}</span>}
                      </div>
                      <p className="text-sm text-foreground/70 font-sans leading-relaxed">{s.meaning}</p>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        {/* Compound builder + reference */}
        <div className="space-y-4">
          <Card className="bg-card/40 border-border/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="font-display tracking-widest text-sm text-primary/80">{t("compoundBuilder")}</CardTitle>
            </CardHeader>
            <CardContent>
              {selected.length === 0 ? (
                <div className="text-center py-8 font-mono text-xs text-muted-foreground/50 uppercase tracking-widest">
                  {t("builderEmpty")}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    {selectedSymbols.map((s, i) => (
                      <div key={s.id} className="flex items-center gap-2">
                        <span className="text-3xl">{s.glyph}</span>
                        {i < selectedSymbols.length - 1 && <span className="text-muted-foreground font-mono">+</span>}
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-border/30 pt-4 space-y-2">
                    <p className="font-mono text-xs text-muted-foreground/60 uppercase">{t("expression")}</p>
                    <p className="font-mono text-sm text-primary">{compound}</p>
                    <p className="font-mono text-xs text-muted-foreground/60 uppercase mt-3">{t("interpretation")}</p>
                    <p className="text-sm text-foreground/80 font-sans italic leading-relaxed">{compoundMeaning}</p>
                  </div>
                  <button onClick={() => setSelected([])}
                    className="font-mono text-xs uppercase text-muted-foreground hover:text-foreground transition-colors">
                    {t("clearSelection")}
                  </button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Known compound examples */}
          {symbols && symbols[0]?.compounds && (
            <Card className="bg-card/40 border-border/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="font-display tracking-widest text-sm text-primary/80">{t("knownCompounds")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {symbols.flatMap(s => {
                  const lines = (s.compounds ?? "").split(";").map(l => l.trim()).filter(Boolean);
                  return lines.slice(0, 1);
                }).slice(0, 5).map((compound, i) => {
                  const [expr, ...rest] = compound.split("=");
                  return (
                    <div key={i} className="border-l-2 border-primary/20 pl-3 space-y-0.5">
                      <p className="font-mono text-sm text-primary">{expr?.trim()}</p>
                      {rest.length > 0 && <p className="font-mono text-xs text-muted-foreground/70">{rest.join("=").trim()}</p>}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Emotive Expression Layer */}
      <div className="pt-4 border-t border-border/30 space-y-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-2xl font-bold tracking-widest text-amber-400">{t("emotiveLayerTitle")}</h3>
          <p className="text-sm font-mono text-muted-foreground">
            {t("emotiveLayerSubtitle")}
          </p>
          <p className="text-xs font-mono text-muted-foreground/60 leading-relaxed max-w-3xl mt-1">
            {t("emotiveLayerBody")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">{t("valence")}</span>
            {["All", "Positive", "Neutral", "Negative"].map(v => (
              <button key={v} onClick={() => setValenceFilter(v)}
                data-testid={`filter-valence-${v.toLowerCase()}`}
                className={`font-mono text-[10px] uppercase tracking-widest px-2 py-1 rounded border transition-colors ${
                  valenceFilter === v ? "border-amber-400/60 text-amber-400 bg-amber-400/5" : "border-border/30 text-muted-foreground/60 hover:text-foreground/80"
                }`}>
                {t(`filters.${v.toLowerCase()}`)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">{t("arousal")}</span>
            {["All", "Low", "Medium", "High"].map(a => (
              <button key={a} onClick={() => setArousalFilter(a)}
                data-testid={`filter-arousal-${a.toLowerCase()}`}
                className={`font-mono text-[10px] uppercase tracking-widest px-2 py-1 rounded border transition-colors ${
                  arousalFilter === a ? "border-amber-400/60 text-amber-400 bg-amber-400/5" : "border-border/30 text-muted-foreground/60 hover:text-foreground/80"
                }`}>
                {t(`filters.${a.toLowerCase()}`)}
              </button>
            ))}
          </div>
        </div>

        {exprLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-28 bg-primary/5" />)}
          </div>
        ) : filteredExpressions.length === 0 ? (
          <div className="text-center py-10 font-mono text-xs text-muted-foreground/50 uppercase tracking-widest">
            {t("noExpressionsMatch")}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredExpressions.map(e => {
              const valColor = VALENCE_COLORS[e.valence] ?? "text-primary border-primary/40";
              const bars = AROUSAL_BARS[e.arousal] ?? 0;
              return (
                <Card key={e.id} className="bg-card/40 border-border/30 backdrop-blur-sm hover:border-border/60 transition-colors"
                  data-testid={`card-expression-${e.id}`}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <span className={`font-mono text-2xl leading-none ${valColor.split(" ")[0]}`}>{e.glyph}</span>
                      <div className="flex flex-col items-end gap-1">
                        <Badge variant="outline" className={`font-mono text-[9px] uppercase ${valColor}`}>{e.valence}</Badge>
                        <div className="flex items-center gap-0.5" title={t("arousalTooltip", { level: e.arousal })}>
                          {[1, 2, 3].map(n => (
                            <span key={n} className={`h-1 w-3 rounded-full ${n <= bars ? "bg-amber-400/80" : "bg-border/40"}`} />
                          ))}
                        </div>
                      </div>
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-display font-bold uppercase tracking-widest text-sm text-foreground/90">{e.name}</span>
                        <Badge variant="outline" className="font-mono text-[8px] uppercase border-border/40 text-muted-foreground/70">{e.family}</Badge>
                      </div>
                      <p className="text-xs text-foreground/60 font-sans leading-relaxed mt-1">{e.notes}</p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
