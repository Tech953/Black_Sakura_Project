import { Bullet, SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function Slide6() {
  return (
    <SlideShell number="06" section="BELIEF / 05">
      <div className="grid h-full grid-cols-[0.82fr_1.18fr] gap-[6vw] px-[8vw] pt-[16vh]">
        <div>
          <SlideTitle eyebrow="BELIEF REGISTRY">
            Beliefs are registered, not smuggled into a prompt
          </SlideTitle>
          <div className="mt-[6vh] deck-panel p-[2vw]">
            <div className="deck-mono text-[1vw] text-amber">BELIEF / 0042</div>
            <div className="mt-[2vh] text-[2.4vw] leading-[1.08] text-text">
              “This person values direct answers when pressure is high.”
            </div>
            <div className="mt-[3vh] flex items-center justify-between border-t border-line pt-[1.5vh] text-[1.05vw] text-muted">
              <span>SOURCE: CHAT / 118</span>
              <span className="text-amber">CONFIDENCE 0.78</span>
            </div>
          </div>
        </div>
        <div className="pt-[4vh]">
          <Bullet number="01">Every belief has a source and confidence</Bullet>
          <Bullet number="02">New evidence can reinforce, challenge, or retire it</Bullet>
          <Bullet number="03">The system can show why a belief exists</Bullet>
          <Bullet number="04">Persona synthesis starts from observed and remembered evidence</Bullet>
          <Bullet number="05" amber>
            The operator can inspect the path from evidence to expression
          </Bullet>
        </div>
      </div>
    </SlideShell>
  );
}