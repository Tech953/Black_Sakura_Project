import { Node, SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function Slide3() {
  return (
    <SlideShell number="03" section="MODEL / 02">
      <div className="px-[7vw] pt-[14vh]">
        <SlideTitle eyebrow="THE MODEL">A companion is a system, not a prompt</SlideTitle>
        <div className="mt-[7vh] grid grid-cols-5 gap-[1vw]">
          <Node label="IDENTITY:" detail="who the engram is" />
          <Node label="MEMORY:" detail="what it has observed and remembered" />
          <Node label="BELIEF:" detail="what it currently holds as true" tone="amber" />
          <Node label="DRIVES:" detail="what creates pressure to act" />
          <Node label="EXPRESSION:" detail="how it speaks and reaches out" />
        </div>
        <div className="mt-[5vh] flex items-center gap-[1vw] text-[1.15vw] text-muted">
          <div className="h-[0.25vh] w-[7vw] bg-primary" />
          <span>STATE is structured before it becomes LANGUAGE</span>
        </div>
      </div>
    </SlideShell>
  );
}