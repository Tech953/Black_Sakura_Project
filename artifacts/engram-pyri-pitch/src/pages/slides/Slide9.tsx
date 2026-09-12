import { SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function Slide9() {
  return (
    <SlideShell number="09" section="EXPRESSION / 08">
      <div className="px-[8vw] pt-[14vh]">
        <SlideTitle eyebrow="HIERO-CODE">Hiero-Code: expression with a safety boundary</SlideTitle>
        <div className="mt-[6vh] grid grid-cols-[1fr_1fr] gap-[5vw]">
          <div>
            <div className="deck-mono mb-[1.5vh] text-[1vw] text-primary">MICRO-EXPRESSION VOCABULARY</div>
            <div className="grid grid-cols-2 gap-[1vw]">
              <div className="deck-chip p-[1.5vw]"><div className="deck-display text-[2.4vw] font-semibold">ATTUNE</div><div className="mt-[1vh] text-[1.1vw] text-muted">tone and intent</div></div>
              <div className="deck-chip p-[1.5vw]"><div className="deck-display text-[2.4vw] font-semibold">HOLD</div><div className="mt-[1vh] text-[1.1vw] text-muted">hesitation and care</div></div>
              <div className="deck-chip p-[1.5vw]"><div className="deck-display text-[2.4vw] font-semibold">TURN</div><div className="mt-[1vh] text-[1.1vw] text-muted">shift perspective</div></div>
              <div className="deck-chip p-[1.5vw]"><div className="deck-display text-[2.4vw] font-semibold">OPEN</div><div className="mt-[1vh] text-[1.1vw] text-muted">invite response</div></div>
            </div>
            <div className="mt-[2vh] text-[1.15vw] leading-[1.3] text-muted">
              A controlled micro-expression vocabulary carries tone and intent.
              It gives the system more range than sentiment labels.
            </div>
          </div>
          <div className="deck-panel-amber relative p-[2.3vw]">
            <div className="deck-mono text-[1vw] text-amber">BOUNDARY / ENFORCED</div>
            <div className="mt-[2.5vh] text-[2.35vw] leading-[1.1] text-text">
              Intimate expression data stays outside PYRI&apos;s chat prompt.
            </div>
            <div className="mt-[2vh] text-[1.15vw] leading-[1.3] text-muted">
              The boundary protects both the person and the persona.
            </div>
            <div className="absolute bottom-[2vw] left-[2.3vw] right-[2.3vw] flex items-center gap-[1vw] border-t border-amber/30 pt-[1.5vh] text-[1.1vw] text-muted">
              <div className="h-[0.9vh] w-[0.9vh] bg-amber" />
              <span>The chat model receives safe, ranked expression context.</span>
            </div>
          </div>
        </div>
        <div className="mt-[4vh] border-l-2 border-primary pl-[2vw] text-[1.5vw] text-muted">
          More range than sentiment labels. More separation than a hidden prompt.
        </div>
      </div>
    </SlideShell>
  );
}