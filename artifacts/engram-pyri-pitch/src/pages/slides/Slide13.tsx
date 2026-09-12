import { SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function Slide13() {
  return (
    <SlideShell number="13" section="SURFACES / 12">
      <div className="px-[8vw] pt-[14vh]">
        <SlideTitle eyebrow="ONE ARCHITECTURE">One architecture, two surfaces</SlideTitle>
        <div className="mt-[6vh] grid grid-cols-2 gap-[1.2vw]">
          <div className="deck-panel p-[2.2vw]">
            <div className="flex items-center justify-between">
              <div className="deck-display text-[3vw] font-semibold text-primary">WEB</div>
              <div className="deck-mono text-[0.9vw] text-muted">UNDERSTAND</div>
            </div>
            <div className="mt-[4vh] space-y-[1.8vh] text-[1.55vw] text-text">
              <div>Inspection</div><div>Tuning</div><div>Orchestration</div>
            </div>
          </div>
          <div className="deck-panel-amber p-[2.2vw]">
            <div className="flex items-center justify-between">
              <div className="deck-display text-[3vw] font-semibold text-amber">MOBILE</div>
              <div className="deck-mono text-[0.9vw] text-muted">BE PRESENT</div>
            </div>
            <div className="mt-[4vh] space-y-[1.8vh] text-[1.55vw] text-text">
              <div>Continuity</div><div>Contact</div><div>Quick reflection</div>
            </div>
          </div>
        </div>
        <div className="relative mx-auto mt-[3vh] h-[12vh] w-[64vw] border border-line bg-surface">
          <div className="absolute left-1/2 top-[-1.7vh] h-[3.4vh] w-[3.4vh] -translate-x-1/2 rotate-45 border border-primary bg-bg" />
          <div className="flex h-full items-center justify-center">
            <div className="deck-display text-[2.6vw] font-semibold">SHARED EVIDENCE LOOP</div>
          </div>
        </div>
        <div className="mt-[3vh] text-center text-[1.35vw] leading-[1.4] text-muted">
          Shared account state keeps the selected engram consistent. The same
          safety policies govern both surfaces. Every surface feeds the same
          evidence loop.
        </div>
      </div>
    </SlideShell>
  );
}