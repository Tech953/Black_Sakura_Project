import { SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function DeepInquiry() {
  return (
    <SlideShell number="18" section="EXPERIENCE / 17">
      <div className="px-[8vw] pt-[14vh]">
        <SlideTitle eyebrow="INQUIRY">Inquiry gives the operator a safe control surface</SlideTitle>
        <div className="mt-[7vh] grid grid-cols-2 gap-[1.2vw]">
          <div className="deck-panel p-[2.2vw]"><div className="deck-display text-[3.2vw] font-semibold text-primary">PROBE</div><div className="mt-[2vh] text-[1.5vw] leading-[1.25] text-text">Ask how an engram sees the world.</div><div className="mt-[4vh] deck-mono text-[0.9vw] text-muted">RESPONSE + HISTORY</div></div>
          <div className="deck-panel-amber p-[2.2vw]"><div className="deck-display text-[3.2vw] font-semibold text-amber">DEVELOP</div><div className="mt-[2vh] text-[1.5vw] leading-[1.25] text-text">Tune future behavior through a guarded inquiry.</div><div className="mt-[4vh] deck-mono text-[0.9vw] text-muted">CONFIG DELTA + HISTORY</div></div>
        </div>
        <div className="mt-[4vh] text-[1.4vw] text-muted">The operator sees the question, response, and resulting change together.</div>
      </div>
    </SlideShell>
  );
}