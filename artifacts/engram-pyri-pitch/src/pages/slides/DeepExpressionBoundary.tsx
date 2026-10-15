import { SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function DeepExpressionBoundary() {
  return (
    <SlideShell number="16" section="EXPRESSION / 15">
      <div className="px-[8vw] pt-[14vh]">
        <SlideTitle eyebrow="HIERO-CODE / BOUNDARY">PYRI speaks through an expression layer</SlideTitle>
        <div className="mt-[7vh] grid grid-cols-[0.9fr_1.1fr] gap-[5vw]">
          <div className="space-y-[1.2vh]">
            <div className="deck-chip p-[1.2vw] text-[1.55vw]">tone and intent</div>
            <div className="deck-chip p-[1.2vw] text-[1.55vw]">hesitation and care</div>
            <div className="deck-chip p-[1.2vw] text-[1.55vw]">shift perspective</div>
            <div className="deck-chip p-[1.2vw] text-[1.55vw]">invite response</div>
          </div>
          <div className="deck-panel-amber p-[2.4vw]">
            <div className="deck-mono text-[1vw] text-amber">SAFE CONTEXT ONLY</div>
            <div className="mt-[2vh] text-[2.4vw] leading-[1.08] text-text">The chat model receives ranked expression cues, not intimate expression data.</div>
            <div className="mt-[3vh] text-[1.2vw] leading-[1.35] text-muted">The boundary protects both the person and the persona.</div>
          </div>
        </div>
      </div>
    </SlideShell>
  );
}