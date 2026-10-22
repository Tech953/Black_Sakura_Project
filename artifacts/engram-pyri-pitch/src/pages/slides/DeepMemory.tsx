import { Node, SlideShell, SlideTitle } from "../../components/SlidePrimitives";

export default function DeepMemory() {
  return (
    <SlideShell number="06" section="MEMORY / 05">
      <div className="px-[8vw] pt-[14vh]">
        <SlideTitle eyebrow="MEMORY PIPELINE">Memory turns moments into continuity</SlideTitle>
        <div className="mt-[7vh] grid grid-cols-4 gap-[1vw]">
          <Node label="NOTICE" detail="capture what happened in the exchange" />
          <Node label="WEIGH" detail="separate signal from noise" tone="amber" />
          <Node label="RETAIN" detail="keep what can matter later" />
          <Node label="RECALL" detail="bring the right context forward" tone="amber" />
        </div>
        <div className="mx-auto mt-[5vh] max-w-[62vw] text-center text-[2.2vw] leading-[1.12] text-text">
          Continuity comes from selection, not from remembering everything.
        </div>
      </div>
    </SlideShell>
  );
}