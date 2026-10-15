import { Bullet, SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function DeepIdentity() {
  return (
    <SlideShell number="04" section="MODEL / 03">
      <div className="grid h-full grid-cols-[0.9fr_1.1fr] gap-[7vw] px-[8vw] pt-[15vh]">
        <SlideTitle eyebrow="IDENTITY LAYER">Identity gives the engram a stable center</SlideTitle>
        <div className="pt-[1vh]">
          <Bullet number="01">A named persona with a distinct voice</Bullet>
          <Bullet number="02">Anchors that keep expression recognizable over time</Bullet>
          <Bullet number="03">Guardrails that define what the engram will not become</Bullet>
          <Bullet number="04">A configuration that can develop without losing continuity</Bullet>
          <Bullet number="05" amber>Archival identity remains inspectable and read-only</Bullet>
        </div>
      </div>
    </SlideShell>
  );
}