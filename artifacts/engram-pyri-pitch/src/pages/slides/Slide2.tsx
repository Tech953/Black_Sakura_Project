import { Bullet, FooterTag, SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function Slide2() {
  return (
    <SlideShell number="02" section="THESIS / 01">
      <div className="flex h-full flex-col justify-center px-[10vw]">
        <SlideTitle eyebrow="WHY THIS EXISTS">
          The missing layer between chat and relationship
        </SlideTitle>
        <div className="mt-[6vh] max-w-[76vw]">
          <Bullet number="01">Most AI resets between conversations</Bullet>
          <Bullet number="02">Memory without structure becomes a transcript dump</Bullet>
          <Bullet number="03">Autonomy without boundaries becomes an unsafe surprise</Bullet>
          <Bullet number="04" amber>
            ENGRAM makes continuity, inner state, and consent explicit
          </Bullet>
        </div>
      </div>
      <div className="absolute bottom-[10vh] right-[7vw] h-[15vh] w-[15vw] border border-primary/40">
        <div className="absolute inset-[1.1vw] border border-primary/20" />
        <div className="absolute left-[-0.4vw] top-1/2 h-[0.8vh] w-[0.8vh] bg-amber" />
      </div>
      <FooterTag>FROM CHAT INTERFACE TO CONTINUOUS PRESENCE</FooterTag>
    </SlideShell>
  );
}