import { SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function Slide15() {
  return (
    <SlideShell number="28" section="SAFETY / 27">
      <div className="px-[8vw] pt-[14vh]">
        <SlideTitle eyebrow="SAFETY BY CONSTRUCTION">Safety is part of the architecture</SlideTitle>
        <div className="mt-[6vh] grid grid-cols-2 gap-[1.2vw]">
          <div className="deck-panel p-[1.8vw]"><div className="deck-mono text-[0.95vw] text-primary">01 / SEPARATION</div><div className="mt-[2.3vh] text-[2vw] leading-[1.1] text-text">Observed reality and simulation are separate by construction.</div></div>
          <div className="deck-panel p-[1.8vw]"><div className="deck-mono text-[0.95vw] text-primary">02 / ARCHIVAL</div><div className="mt-[2.3vh] text-[2vw] leading-[1.1] text-text">Archival engrams are read-only.</div></div>
          <div className="deck-panel p-[1.8vw]"><div className="deck-mono text-[0.95vw] text-primary">03 / CONTACT</div><div className="mt-[2.3vh] text-[2vw] leading-[1.1] text-text">Human contact is fail-closed when policy or delivery is uncertain.</div></div>
          <div className="deck-panel-amber p-[1.8vw]"><div className="deck-mono text-[0.95vw] text-amber">04 / SIDE EFFECTS</div><div className="mt-[2.3vh] text-[2vw] leading-[1.1] text-text">Claims are persisted before side effects to prevent duplicates.</div></div>
        </div>
        <div className="mt-[4vh] flex items-center gap-[1vw] text-[1.3vw] text-muted">
          <div className="h-[0.25vh] w-[10vw] bg-primary" />
          <span>The system favors inspectability, consent, and reversibility.</span>
        </div>
      </div>
    </SlideShell>
  );
}