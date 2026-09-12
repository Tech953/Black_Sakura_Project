import { FooterTag, SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function Slide5() {
  return (
    <SlideShell number="07" section="MEMORY / 06">
      <div className="px-[8vw] pt-[14vh]">
        <SlideTitle eyebrow="LAYERED MEMORY">Layered memory keeps context usable</SlideTitle>
        <div className="mt-[6vh] grid grid-cols-[1fr_0.9fr] gap-[5vw]">
          <div className="space-y-[1.4vh]">
            <div className="deck-panel flex h-[9.2vh] items-center gap-[1.8vw] px-[2vw]">
              <div className="h-[1.4vh] w-[1.4vh] bg-primary" />
              <div>
                <div className="deck-display text-[2.1vw] font-semibold">WORKING CONTEXT</div>
                <div className="text-[1.2vw] text-muted">for the live exchange</div>
              </div>
            </div>
            <div className="deck-panel flex h-[9.2vh] items-center gap-[1.8vw] px-[2vw]">
              <div className="h-[1.4vh] w-[1.4vh] bg-primary/80" />
              <div>
                <div className="deck-display text-[2.1vw] font-semibold">EPISODIC MEMORY</div>
                <div className="text-[1.2vw] text-muted">for meaningful moments</div>
              </div>
            </div>
            <div className="deck-panel flex h-[9.2vh] items-center gap-[1.8vw] px-[2vw]">
              <div className="h-[1.4vh] w-[1.4vh] bg-primary/60" />
              <div>
                <div className="deck-display text-[2.1vw] font-semibold">SEMANTIC MEMORY</div>
                <div className="text-[1.2vw] text-muted">for durable patterns</div>
              </div>
            </div>
            <div className="deck-panel-amber flex h-[9.2vh] items-center gap-[1.8vw] px-[2vw]">
              <div className="h-[1.4vh] w-[1.4vh] bg-amber" />
              <div>
                <div className="deck-display text-[2.1vw] font-semibold">WORLD MODEL</div>
                <div className="text-[1.2vw] text-muted">current, reviewable observations</div>
              </div>
            </div>
          </div>
          <div className="flex flex-col justify-center">
            <div className="deck-mono text-[1.05vw] text-primary">EVIDENCE TRAVELS WITH STATE</div>
            <p className="mt-[2vh] text-[2.35vw] leading-[1.17] text-text">
              Provenance and confidence travel with the evidence.
            </p>
            <div className="mt-[4vh] h-[0.25vh] w-[13vw] deck-rule" />
            <p className="mt-[2vh] max-w-[24vw] text-[1.35vw] leading-[1.4] text-muted">
              The system can separate what happened, what was inferred, and
              what remains uncertain.
            </p>
          </div>
        </div>
      </div>
      <FooterTag>MEMORY IS A STRUCTURE, NOT A STORAGE BUCKET</FooterTag>
    </SlideShell>
  );
}