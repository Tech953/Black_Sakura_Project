import { Node, SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function Slide4() {
  return (
    <SlideShell number="04" section="ARCHITECTURE / 03">
      <div className="px-[7vw] pt-[13vh]">
        <SlideTitle eyebrow="THE LOOP">The ENGRAM cognitive loop</SlideTitle>
        <div className="mt-[7vh] grid grid-cols-5 items-center gap-[0.8vw]">
          <Node label="PERCEIVE:" detail="conversations, media, and world-model evidence" />
          <div className="h-[0.2vh] bg-primary" />
          <Node label="CONSOLIDATE:" detail="retain durable observations and memories" />
          <div className="h-[0.2vh] bg-primary" />
          <Node label="INTERPRET:" detail="update beliefs with provenance and confidence" tone="amber" />
        </div>
        <div className="mx-auto mt-[2vh] h-[0.2vh] w-[56vw] bg-line" />
        <div className="mx-auto flex w-[56vw] items-center justify-between">
          <Node label="SIMULATE:" detail="explore possible next states without changing reality" />
          <div className="w-[7vw] border-t border-dashed border-amber" />
          <Node label="EXPRESS:" detail="respond, inquire, or initiate under policy" tone="amber" />
        </div>
        <div className="mt-[4vh] text-center deck-mono text-[1vw] text-muted">
          EACH PASS LEAVES REVIEWABLE EVIDENCE
        </div>
      </div>
    </SlideShell>
  );
}