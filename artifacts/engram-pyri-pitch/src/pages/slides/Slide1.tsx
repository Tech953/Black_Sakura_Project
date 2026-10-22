import { CornerMark, SlideShell } from "../../components/SlidePrimitives";

const base = import.meta.env.BASE_URL;

export default function Slide1() {
  return (
    <SlideShell number="01" section="ORIGIN / 00" className="bg-bg">
      <img
        src={`${base}engram-hero.png`}
        crossOrigin="anonymous"
        alt="Abstract layered memory signal field"
        className="absolute inset-0 h-full w-full object-cover opacity-65"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,11,25,0.97)_0%,rgba(7,11,25,0.8)_40%,rgba(7,11,25,0.18)_100%)]" />
      <div className="absolute inset-0 deck-vignette opacity-80" />
      <CornerMark className="left-[6vw] top-[15vh]" />
      <div className="absolute left-[6vw] top-[20vh] max-w-[64vw]">
        <div className="deck-mono mb-[3vh] text-[1.15vw] text-primary">
          COGNITIVE ARCHITECTURE / COMPANION SYSTEM
        </div>
        <h1 className="deck-display text-[10vw] font-bold leading-[0.78] tracking-[-0.03em] text-text">
          ENGRAM
        </h1>
        <div className="mt-[2.6vh] deck-display text-[4.4vw] font-semibold leading-none text-amber">
          // PYRI
        </div>
        <p className="mt-[5vh] max-w-[46vw] text-[2.1vw] leading-[1.22] text-text">
          A cognitive architecture for companions that remember, develop, and
          reach out with boundaries.
        </p>
        <div className="mt-[4vh] flex items-center gap-[1.5vw]">
          <div className="h-[0.25vh] w-[8vw] bg-primary" />
          <span className="text-[1.2vw] text-muted">
            Hiero-Code expression layer • web dashboard • native mobile
            companion
          </span>
        </div>
      </div>
      <div className="absolute bottom-[8vh] right-[7vw] w-[19vw] border-l border-primary/50 pl-[1.4vw]">
        <div className="deck-mono text-[0.95vw] text-primary">SYSTEM STATUS</div>
        <div className="mt-[1vh] text-[1.2vw] leading-[1.3] text-muted">
          MEMORY ONLINE
          <br />
          BOUNDARIES ACTIVE
        </div>
      </div>
    </SlideShell>
  );
}