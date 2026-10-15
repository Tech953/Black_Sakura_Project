import { Bullet, SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function DeepSafetyControls() {
  return (
    <SlideShell number="29" section="SAFETY / 28">
      <div className="grid h-full grid-cols-[0.9fr_1.1fr] gap-[6vw] px-[8vw] pt-[15vh]">
        <SlideTitle eyebrow="CONTROL SURFACE">Safety controls are explicit</SlideTitle>
        <div className="pt-[1vh]">
          <Bullet number="01">Consent and quiet mode can stop contact</Bullet>
          <Bullet number="02">Archival branches cannot be edited</Bullet>
          <Bullet number="03">Simulation cannot become observed reality</Bullet>
          <Bullet number="04">Persisted claims make external sends retry-safe</Bullet>
          <Bullet number="05" amber>Inspectability is a product capability, not a compliance afterthought</Bullet>
        </div>
      </div>
    </SlideShell>
  );
}