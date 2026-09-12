import { SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function Slide11() {
  return (
    <SlideShell number="11" section="SURFACES / 10">
      <div className="px-[7vw] pt-[14vh]">
        <SlideTitle eyebrow="WEB">Web: the operator&apos;s cognitive dashboard</SlideTitle>
        <div className="mt-[5vh] grid grid-cols-[0.28fr_1fr] overflow-hidden border border-line bg-surface">
          <div className="border-r border-line p-[1.5vw]">
            <div className="deck-display text-[1.7vw] font-semibold text-primary">ENGRAM</div>
            <div className="mt-[4vh] space-y-[2vh] text-[1.1vw] text-muted">
              <div className="text-text">OVERVIEW</div>
              <div>MEMORY</div>
              <div>BELIEFS</div>
              <div>DRIVES</div>
              <div>TRANSMISSIONS</div>
            </div>
          </div>
          <div className="p-[1.7vw]">
            <div className="flex items-end justify-between">
              <div><div className="deck-mono text-[0.95vw] text-primary">ACTIVE ENGRAM / PYRI</div><div className="mt-[0.8vh] deck-display text-[2.6vw] font-semibold">COGNITIVE STATE</div></div>
              <div className="deck-mono text-[0.95vw] text-amber">LIVE / 04:21:18</div>
            </div>
            <div className="mt-[3vh] grid grid-cols-3 gap-[1vw]">
              <div className="deck-panel-amber p-[1.25vw]"><div className="deck-mono text-[0.85vw] text-amber">PRESSURE</div><div className="mt-[1.2vh] deck-display text-[3.4vw] font-bold">72</div><div className="text-[1vw] text-muted">connection</div></div>
              <div className="deck-panel p-[1.25vw]"><div className="deck-mono text-[0.85vw] text-primary">BELIEFS</div><div className="mt-[1.2vh] deck-display text-[3.4vw] font-bold">18</div><div className="text-[1vw] text-muted">registered</div></div>
              <div className="deck-panel p-[1.25vw]"><div className="deck-mono text-[0.85vw] text-primary">EVIDENCE</div><div className="mt-[1.2vh] deck-display text-[3.4vw] font-bold">126</div><div className="text-[1vw] text-muted">reviewable</div></div>
            </div>
            <div className="mt-[2vh] h-[13vh] border border-line p-[1.1vw]">
              <div className="deck-mono text-[0.85vw] text-muted">RECENT TRANSMISSIONS</div>
              <div className="mt-[1.8vh] flex items-end gap-[0.7vw]">
                <div className="h-[3vh] w-[3vw] bg-primary/30" /><div className="h-[6vh] w-[3vw] bg-primary/50" /><div className="h-[4.5vh] w-[3vw] bg-primary/40" /><div className="h-[8vh] w-[3vw] bg-amber/70" /><div className="h-[5vh] w-[3vw] bg-primary/40" /><div className="h-[9vh] w-[3vw] bg-primary" />
              </div>
            </div>
          </div>
        </div>
        <div className="mt-[3vh] max-w-[75vw] text-[1.3vw] leading-[1.35] text-muted">
          Inspect engrams, memory, beliefs, drives, and transmissions. Watch
          autonomous activity as it happens. Tune a persona through guarded
          controls. Review provenance instead of trusting invisible state. Use
          the Hub as the system-of-record surface.
        </div>
      </div>
    </SlideShell>
  );
}