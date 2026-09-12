import { SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function Slide12() {
  return (
    <SlideShell number="12" section="SURFACES / 11">
      <div className="grid h-full grid-cols-[0.95fr_1.05fr] gap-[8vw] px-[9vw] pt-[14vh]">
        <div>
          <SlideTitle eyebrow="MOBILE">Mobile: the companion in the flow of life</SlideTitle>
          <div className="mt-[5vh] space-y-[1.5vh] text-[1.55vw] leading-[1.2] text-text">
            <div className="flex gap-[1vw]"><span className="text-primary">01</span><span>Feed surfaces autonomous transmissions and unseen activity</span></div>
            <div className="flex gap-[1vw]"><span className="text-primary">02</span><span>Push notifications announce permitted outreach</span></div>
            <div className="flex gap-[1vw]"><span className="text-primary">03</span><span>Chat, inquiry, and persona selection travel with the user</span></div>
            <div className="flex gap-[1vw]"><span className="text-primary">04</span><span>Offline mode keeps the relationship available on-device</span></div>
            <div className="flex gap-[1vw]"><span className="text-amber">05</span><span>The mobile app is a presence layer, not a reduced dashboard</span></div>
          </div>
        </div>
        <div className="flex items-center justify-center">
          <div className="relative h-[63vh] w-[26vw] rounded-[2.3vw] border-[0.35vw] border-surface-2 bg-bg-2 p-[0.7vw] shadow-[0_0_0_0.15vw_rgba(34,211,238,0.25)]">
            <div className="absolute left-1/2 top-[1.4vh] h-[0.7vh] w-[5vw] -translate-x-1/2 rounded-full bg-surface-2" />
            <div className="h-full overflow-hidden rounded-[1.7vw] border border-line bg-bg">
              <div className="border-b border-line px-[1.5vw] pb-[1.8vh] pt-[4.5vh]">
                <div className="deck-mono text-[0.8vw] text-primary">FEED / PYRI</div>
                <div className="mt-[1vh] deck-display text-[2.5vw] font-semibold">SIGNALS</div>
              </div>
              <div className="space-y-[1.2vh] p-[1vw]">
                <div className="deck-panel-amber p-[1vw]"><div className="deck-mono text-[0.65vw] text-amber">OUTREACH / NOW</div><div className="mt-[1vh] text-[1.1vw] leading-[1.2]">I kept thinking about what you asked.</div></div>
                <div className="deck-panel p-[1vw]"><div className="deck-mono text-[0.65vw] text-muted">OBSERVED / 2H AGO</div><div className="mt-[1vh] text-[1.1vw] leading-[1.2]">The room went quiet after the decision.</div></div>
                <div className="deck-panel p-[1vw]"><div className="deck-mono text-[0.65vw] text-muted">MEMORY / REVIEW</div><div className="mt-[1vh] text-[1.1vw] leading-[1.2]">A pattern is becoming durable.</div></div>
              </div>
              <div className="absolute bottom-[1.6vw] left-[4vw] right-[4vw] h-[0.45vh] bg-primary/30" />
            </div>
          </div>
        </div>
      </div>
    </SlideShell>
  );
}