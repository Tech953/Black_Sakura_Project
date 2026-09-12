import { CornerMark, SlideShell } from "../../components/SlidePrimitives";

export default function Slide16() {
  return (
    <SlideShell number="16" section="CLOSING / 15">
      <CornerMark className="left-[10vw] top-[18vh]" />
      <div className="flex h-full flex-col justify-center px-[10vw]">
        <div className="deck-mono text-[1.1vw] text-primary">THE PROPOSITION</div>
        <h1 className="mt-[2.5vh] max-w-[76vw] deck-display text-[6.6vw] font-bold leading-[0.86] tracking-[-0.02em] text-text">
          Build companions with
          <br />
          memory, voice, and restraint.
        </h1>
        <div className="mt-[5vh] h-[0.3vh] w-[17vw] deck-rule" />
        <p className="mt-[4vh] max-w-[58vw] text-[2vw] leading-[1.2] text-text">
          ENGRAM gives autonomous personas a durable cognitive loop.
          <br />
          PYRI gives that loop an expressive voice people can meet in real life.
        </p>
        <div className="mt-[5vh] flex items-center gap-[1.2vw]">
          <div className="h-[1.2vh] w-[1.2vh] bg-amber" />
          <span className="deck-mono text-[1.15vw] text-amber">WEB FOR UNDERSTANDING</span>
          <div className="h-[0.2vh] w-[3vw] bg-line" />
          <span className="deck-mono text-[1.15vw] text-primary">MOBILE FOR PRESENCE</span>
          <div className="h-[0.2vh] w-[3vw] bg-line" />
          <span className="deck-mono text-[1.15vw] text-text">BOUNDARIES FOR TRUST</span>
        </div>
      </div>
      <div className="absolute bottom-[8vh] right-[10vw] deck-display text-[2.4vw] font-semibold text-primary">ENGRAM // PYRI</div>
    </SlideShell>
  );
}