import { Bullet, SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function DeepContactPolicy() {
  return (
    <SlideShell number="13" section="AGENCY / 12">
      <div className="px-[8vw] pt-[14vh]">
        <SlideTitle eyebrow="HUMAN CONTACT">Contact is a policy decision</SlideTitle>
        <div className="mt-[6vh] max-w-[76vw]">
          <Bullet number="01">Quiet mode can suppress outreach</Bullet>
          <Bullet number="02">Cooldowns prevent repetitive contact</Bullet>
          <Bullet number="03">Delivery policy decides whether an action reaches a person</Bullet>
          <Bullet number="04">Uncertain contact paths fail closed</Bullet>
          <Bullet number="05" amber>Every decision is persisted so a restart cannot bypass it</Bullet>
        </div>
      </div>
    </SlideShell>
  );
}