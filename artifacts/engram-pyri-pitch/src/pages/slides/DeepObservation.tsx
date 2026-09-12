import { SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function DeepObservation() {
  return (
    <SlideShell number="08" section="BELIEF / 07">
      <div className="px-[8vw] pt-[14vh]">
        <SlideTitle eyebrow="EVIDENCE DISCIPLINE">Observation is not belief</SlideTitle>
        <div className="mt-[7vh] grid grid-cols-3 gap-[1.2vw]">
          <div className="deck-panel p-[2vw]"><div className="deck-mono text-[1vw] text-primary">OBSERVED</div><div className="mt-[2vh] text-[2.05vw] leading-[1.08] text-text">What the system has direct evidence for.</div><div className="mt-[4vh] text-[1.1vw] text-muted">source attached</div></div>
          <div className="deck-panel-amber p-[2vw]"><div className="deck-mono text-[1vw] text-amber">INFERRED</div><div className="mt-[2vh] text-[2.05vw] leading-[1.08] text-text">What the evidence may mean.</div><div className="mt-[4vh] text-[1.1vw] text-muted">confidence attached</div></div>
          <div className="deck-panel p-[2vw]"><div className="deck-mono text-[1vw] text-primary">REVISED</div><div className="mt-[2vh] text-[2.05vw] leading-[1.08] text-text">What changes when new evidence arrives.</div><div className="mt-[4vh] text-[1.1vw] text-muted">history preserved</div></div>
        </div>
        <div className="mt-[5vh] flex items-center gap-[1vw] text-[1.35vw] text-muted"><div className="h-[0.25vh] w-[9vw] bg-primary" /><span>Belief is a living register, not hidden prompt state.</span></div>
      </div>
    </SlideShell>
  );
}