import { Node, SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function DeepEvidenceLoop() {
  return (
    <SlideShell number="19" section="EXPERIENCE / 18">
      <div className="px-[8vw] pt-[14vh]">
        <SlideTitle eyebrow="CONTINUITY">Conversation and initiative share the same evidence loop</SlideTitle>
        <div className="mt-[7vh] grid grid-cols-4 gap-[1vw]">
          <Node label="SPEAK" detail="the engram answers in voice" />
          <Node label="OBSERVE" detail="the exchange becomes evidence" tone="amber" />
          <Node label="UPDATE" detail="memory and beliefs become more precise" />
          <Node label="REACH" detail="a future action can be earned" tone="amber" />
        </div>
        <div className="mt-[5vh] border-l-2 border-primary pl-[2vw] text-[2vw] leading-[1.1] text-text">The relationship compounds because interaction changes what the system knows.</div>
      </div>
    </SlideShell>
  );
}