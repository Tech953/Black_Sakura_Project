import { Bullet, SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function DeepDashboard() {
  return (
    <SlideShell number="21" section="SURFACES / 20">
      <div className="grid h-full grid-cols-[0.82fr_1.18fr] gap-[6vw] px-[8vw] pt-[15vh]">
        <SlideTitle eyebrow="OPERATOR WORKFLOW">The dashboard exposes the cognitive state</SlideTitle>
        <div className="pt-[1vh]">
          <Bullet number="01">Select an engram and inspect its current state</Bullet>
          <Bullet number="02">Trace memories, beliefs, drives, and transmissions</Bullet>
          <Bullet number="03">Tune guarded configuration through inquiry</Bullet>
          <Bullet number="04">Review provenance before trusting a conclusion</Bullet>
          <Bullet number="05" amber>Use the Hub as the system-of-record surface</Bullet>
        </div>
      </div>
    </SlideShell>
  );
}