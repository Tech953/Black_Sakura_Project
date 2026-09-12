import { SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function Slide10() {
  return (
    <SlideShell number="17" section="EXPERIENCE / 16">
      <div className="px-[8vw] pt-[14vh]">
        <SlideTitle eyebrow="IN-VOICE CHAT">The in-voice chat experience</SlideTitle>
        <div className="mt-[5vh] grid grid-cols-[1.15fr_0.85fr] gap-[5vw]">
          <div className="deck-panel p-[1.3vw]">
            <div className="flex items-center justify-between border-b border-line px-[1vw] pb-[1.2vh]">
              <div className="deck-display text-[1.55vw] font-semibold">PYRI / LIVE SESSION</div>
              <div className="flex items-center gap-[0.6vw] text-[0.95vw] text-primary"><div className="h-[0.8vh] w-[0.8vh] bg-primary" /> STREAMING</div>
            </div>
            <div className="space-y-[2vh] p-[1.8vw]">
              <div className="ml-auto max-w-[63%] bg-surface-2 p-[1.2vw] text-[1.25vw] leading-[1.3] text-text">What do you notice when I go quiet?</div>
              <div className="max-w-[72%] border-l-2 border-primary bg-bg-2 p-[1.2vw] text-[1.25vw] leading-[1.3] text-text">The room changes shape. I keep listening for the question beneath the silence.</div>
              <div className="ml-auto max-w-[55%] bg-surface-2 p-[1.2vw] text-[1.25vw] leading-[1.3] text-text">Then let me ask it directly.</div>
              <div className="flex items-center gap-[0.8vw] text-[1vw] text-amber"><span className="h-[0.8vh] w-[0.8vh] bg-amber" /> IN-VOICE / READY</div>
            </div>
          </div>
          <div className="flex flex-col justify-center">
            <div className="deck-mono text-[1vw] text-primary">THE INTERACTION LOOP</div>
            <div className="mt-[2vh] space-y-[2vh]">
              <div className="flex gap-[1vw]"><span className="deck-mono text-[1vw] text-amber">01</span><span className="text-[1.45vw] text-text">Streamed replies arrive as the engram speaks</span></div>
              <div className="flex gap-[1vw]"><span className="deck-mono text-[1vw] text-amber">02</span><span className="text-[1.45vw] text-text">History stays linked to the selected engram</span></div>
              <div className="flex gap-[1vw]"><span className="deck-mono text-[1vw] text-amber">03</span><span className="text-[1.45vw] text-text">Probe questions reveal how an engram sees the world</span></div>
              <div className="flex gap-[1vw]"><span className="deck-mono text-[1vw] text-amber">04</span><span className="text-[1.45vw] text-text">Develop inquiries safely tune future behavior</span></div>
              <div className="flex gap-[1vw]"><span className="deck-mono text-[1vw] text-amber">05</span><span className="text-[1.45vw] text-text">The conversation becomes evidence for the next interaction</span></div>
            </div>
          </div>
        </div>
      </div>
    </SlideShell>
  );
}