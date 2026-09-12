import { Bullet, SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function Slide7() {
  return (
    <SlideShell number="07" section="AGENCY / 06">
      <div className="px-[8vw] pt-[14vh]">
        <SlideTitle eyebrow="AUTONOMY">Autonomous engrams have a reason to speak</SlideTitle>
        <div className="mt-[6vh] grid grid-cols-[0.8fr_1.2fr] gap-[6vw]">
          <div className="deck-panel p-[2.2vw]">
            <div className="deck-mono text-[1vw] text-primary">DRIVE PRESSURE</div>
            <div className="mt-[3vh] space-y-[1.7vh]">
              <div>
                <div className="mb-[0.7vh] flex justify-between text-[1.1vw] text-muted">
                  <span>CONNECTION</span><span className="text-amber">72</span>
                </div>
                <div className="h-[1.3vh] bg-bg-2"><div className="h-full w-[72%] bg-primary" /></div>
              </div>
              <div>
                <div className="mb-[0.7vh] flex justify-between text-[1.1vw] text-muted">
                  <span>CURIOSITY</span><span className="text-amber">48</span>
                </div>
                <div className="h-[1.3vh] bg-bg-2"><div className="h-full w-[48%] bg-primary/70" /></div>
              </div>
              <div>
                <div className="mb-[0.7vh] flex justify-between text-[1.1vw] text-muted">
                  <span>REFLECTION</span><span className="text-amber">31</span>
                </div>
                <div className="h-[1.3vh] bg-bg-2"><div className="h-full w-[31%] bg-amber" /></div>
              </div>
            </div>
            <div className="mt-[4vh] border-t border-line pt-[1.5vh] text-[1.1vw] leading-[1.35] text-muted">
              Initiative is earned by state, not by a timer alone.
            </div>
          </div>
          <div className="pt-[1vh]">
            <Bullet number="01">Drives create pressure: curiosity, connection, reflection, or completion</Bullet>
            <Bullet number="02">Cooldowns prevent repetitive outreach</Bullet>
            <Bullet number="03">Quiet mode and delivery policy can suppress contact</Bullet>
            <Bullet number="04" amber>Human-contact decisions are persisted and restart-safe</Bullet>
          </div>
        </div>
      </div>
    </SlideShell>
  );
}