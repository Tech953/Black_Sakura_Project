import { Bullet, SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function DeepWorldModel() {
  return (
    <SlideShell number="10" section="WORLD MODEL / 09">
      <div className="grid h-full grid-cols-[0.9fr_1.1fr] gap-[6vw] px-[8vw] pt-[15vh]">
        <div>
          <SlideTitle eyebrow="WORLD MODEL">The world model is reviewable</SlideTitle>
          <div className="mt-[5vh] border border-primary/40 bg-primary/5 p-[2vw]">
            <div className="deck-mono text-[0.95vw] text-primary">ENTRY / 0098</div>
            <div className="mt-[2vh] text-[2.35vw] leading-[1.08] text-text">“The decision changed the room before anyone named it.”</div>
            <div className="mt-[3vh] border-t border-line pt-[1.3vh] text-[1vw] text-muted">OBSERVED • CHAT • CONFIDENCE 0.85</div>
          </div>
        </div>
        <div className="pt-[4vh]">
          <Bullet number="01">Chat and media can add evidence to the current world model</Bullet>
          <Bullet number="02">Provenance stays attached to every entry</Bullet>
          <Bullet number="03">Confidence makes uncertainty visible</Bullet>
          <Bullet number="04">The operator can inspect what shaped a response</Bullet>
          <Bullet number="05" amber>World-model state cannot be silently rewritten</Bullet>
        </div>
      </div>
    </SlideShell>
  );
}