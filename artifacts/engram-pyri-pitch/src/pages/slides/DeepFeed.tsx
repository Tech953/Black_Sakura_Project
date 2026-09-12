import { SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function DeepFeed() {
  return (
    <SlideShell number="23" section="SURFACES / 22">
      <div className="px-[8vw] pt-[14vh]">
        <SlideTitle eyebrow="MOBILE FEED">Mobile turns autonomous activity into a readable signal</SlideTitle>
        <div className="mt-[6vh] grid grid-cols-3 gap-[1.2vw]">
          <div className="deck-panel p-[1.8vw]"><div className="deck-mono text-[0.9vw] text-amber">OUTREACH</div><div className="mt-[2vh] text-[1.8vw] leading-[1.1] text-text">A permitted transmission reaches the Feed.</div></div>
          <div className="deck-panel p-[1.8vw]"><div className="deck-mono text-[0.9vw] text-primary">PUSH</div><div className="mt-[2vh] text-[1.8vw] leading-[1.1] text-text">A notification carries the engram name and a bounded snippet.</div></div>
          <div className="deck-panel-amber p-[1.8vw]"><div className="deck-mono text-[0.9vw] text-amber">TAP</div><div className="mt-[2vh] text-[1.8vw] leading-[1.1] text-text">The user lands directly in the selected engram&apos;s Feed.</div></div>
        </div>
        <div className="mt-[4vh] text-[1.35vw] text-muted">Idle, blocked, queued, quiet-mode, and undelivered outreach do not notify phones.</div>
      </div>
    </SlideShell>
  );
}