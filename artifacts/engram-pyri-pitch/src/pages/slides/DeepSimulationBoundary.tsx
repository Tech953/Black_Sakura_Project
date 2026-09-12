import { SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function DeepSimulationBoundary() {
  return (
    <SlideShell number="27" section="SIMULATION / 26">
      <div className="px-[8vw] pt-[14vh]">
        <SlideTitle eyebrow="QUARANTINE">Simulation extends the space without contaminating reality</SlideTitle>
        <div className="mt-[7vh] grid grid-cols-[1fr_0.18fr_1fr] items-center gap-[1.2vw]">
          <div className="deck-panel p-[2.2vw]"><div className="deck-mono text-[0.95vw] text-primary">LIVE WORLD</div><div className="mt-[2vh] text-[2.5vw] text-text">Observed reality</div><div className="mt-[3vh] text-[1.15vw] text-muted">reviewable evidence • durable state</div></div>
          <div className="flex h-[18vh] items-center justify-center border-x border-dashed border-amber"><div className="h-[4vh] w-[4vh] rotate-45 border border-amber bg-bg" /></div>
          <div className="deck-panel-amber p-[2.2vw]"><div className="deck-mono text-[0.95vw] text-amber">CHAMBER</div><div className="mt-[2vh] text-[2.5vw] text-text">Possible state</div><div className="mt-[3vh] text-[1.15vw] text-muted">what-if • shared space • contained</div></div>
        </div>
        <div className="mt-[5vh] text-center text-[1.5vw] text-muted">Simulation can be rich without becoming an invisible write path.</div>
      </div>
    </SlideShell>
  );
}