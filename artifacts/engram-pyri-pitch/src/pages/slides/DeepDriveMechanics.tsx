import { Node, SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function DeepDriveMechanics() {
  return (
    <SlideShell number="12" section="AGENCY / 11">
      <div className="px-[8vw] pt-[14vh]">
        <SlideTitle eyebrow="DRIVE MECHANICS">Autonomy begins with drives</SlideTitle>
        <div className="mt-[7vh] grid grid-cols-3 gap-[1vw]">
          <Node label="PRESSURE" detail="an unmet need becomes legible" />
          <Node label="CANDIDATE" detail="the engine selects a bounded next action" tone="amber" />
          <Node label="COOLDOWN" detail="the system waits before repeating contact" />
        </div>
        <div className="mt-[5vh] grid grid-cols-[1fr_1fr] gap-[4vw]">
          <div className="text-[1.5vw] leading-[1.25] text-text">Curiosity, connection, reflection, and completion give initiative a reason.</div>
          <div className="border-l-2 border-amber pl-[1.8vw] text-[1.5vw] leading-[1.25] text-muted">A timer can trigger work. A drive explains why this engram speaks now.</div>
        </div>
      </div>
    </SlideShell>
  );
}