import { Node, SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function Slide8() {
  return (
    <SlideShell number="14" section="EXPRESSION / 13">
      <div className="px-[8vw] pt-[14vh]">
        <SlideTitle eyebrow="FROM STATE TO SIGNAL">From inner state to an in-voice response</SlideTitle>
        <div className="mt-[7vh] grid grid-cols-4 gap-[1.2vw]">
          <Node label="SELECT" detail="the engine selects a bounded next action" />
          <Node label="CHECK" detail="safety policy checks whether contact is allowed" tone="amber" />
          <Node label="SHAPE" detail="persona evidence shapes the response" />
          <Node label="SPEAK" detail="Hiero-Code supplies compact expression cues" tone="amber" />
        </div>
        <div className="mt-[5vh] max-w-[68vw] border-l-2 border-primary pl-[2vw]">
          <p className="text-[2.55vw] leading-[1.1] text-text">
            The user receives an answer that sounds like this engram, not a
            generic assistant.
          </p>
        </div>
      </div>
    </SlideShell>
  );
}