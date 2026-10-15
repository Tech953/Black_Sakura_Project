import { Node, SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function Slide14() {
  return (
    <SlideShell number="26" section="SIMULATION / 25">
      <div className="px-[8vw] pt-[14vh]">
        <SlideTitle eyebrow="CONTAINED POSSIBILITY">Simulation is where possibilities stay contained</SlideTitle>
        <div className="mt-[6vh] grid grid-cols-[1.12fr_0.88fr] gap-[5vw]">
          <div className="relative border border-amber/60 bg-amber/5 p-[2vw]">
            <div className="absolute left-[2vw] top-[-1.4vh] bg-bg px-[0.8vw] deck-mono text-[0.9vw] text-amber">SIMULATION CHAMBER / QUARANTINED</div>
            <div className="grid grid-cols-3 gap-[0.8vw] pt-[1.4vh]">
              <Node label="WHAT IF" detail="possible next state" />
              <Node label="SHARED" detail="multiple engrams in one space" />
              <Node label="REVIEW" detail="policy-allowed outcomes only" tone="amber" />
            </div>
            <div className="mt-[3vh] flex items-center gap-[1vw] text-[1.05vw] text-muted">
              <div className="h-[0.2vh] w-[6vw] bg-amber" />
              <span>NO SILENT REWRITE OF LIVE REALITY</span>
            </div>
          </div>
          <div className="space-y-[1.8vh] pt-[1vh] text-[1.55vw] leading-[1.2] text-text">
            <div className="border-b border-line pb-[1.5vh]">What-if scenarios let engrams explore without rewriting reality</div>
            <div className="border-b border-line pb-[1.5vh]">Simulation state is structurally quarantined</div>
            <div className="border-b border-line pb-[1.5vh]">Shared spaces create room for multiple engrams to interact</div>
            <div className="border-b border-line pb-[1.5vh]">Only reviewed, policy-allowed outcomes can affect live behavior</div>
            <div className="text-amber">Exploration becomes a product surface, not an invisible side effect</div>
          </div>
        </div>
      </div>
    </SlideShell>
  );
}