import type { ReactNode } from "react";

export function SlideShell({
  children,
  number,
  section,
  className = "",
}: {
  children: ReactNode;
  number: string;
  section: string;
  className?: string;
}) {
  return (
    <div
      className={`relative h-screen w-screen overflow-hidden bg-bg text-text ${className}`}
    >
      <div className="pointer-events-none absolute inset-0 deck-grid opacity-70" />
      <div className="pointer-events-none absolute inset-0 deck-vignette" />
      <div className="pointer-events-none absolute inset-0 deck-scanlines opacity-20" />
      <div className="absolute left-[6vw] top-[4.4vh] z-20 flex items-center gap-[1vw]">
        <div className="h-[0.9vh] w-[0.9vh] bg-primary" />
        <span className="deck-mono text-[1vw] text-muted">{section}</span>
      </div>
      <div className="absolute right-[6vw] top-[4.4vh] z-20 deck-mono text-[1vw] text-muted">
        {number} / 16
      </div>
      <div className="relative z-10 h-full w-full">{children}</div>
    </div>
  );
}

export function SlideTitle({
  eyebrow,
  children,
  className = "",
}: {
  eyebrow?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {eyebrow ? (
        <div className="deck-mono mb-[1.8vh] text-[1.05vw] text-primary">
          {eyebrow}
        </div>
      ) : null}
      <h1 className="deck-display max-w-[78vw] text-[4vw] font-bold leading-[0.96] tracking-[-0.02em] text-text">
        {children}
      </h1>
      <div className="mt-[2.3vh] h-[0.28vh] w-[12vw] deck-rule" />
    </div>
  );
}

export function Bullet({
  number,
  children,
  amber = false,
}: {
  number: string;
  children: ReactNode;
  amber?: boolean;
}) {
  return (
    <div className="flex items-start gap-[1.6vw] border-b border-line py-[1.45vh]">
      <span
        className={`deck-mono pt-[0.45vh] text-[1.15vw] ${
          amber ? "text-amber" : "text-primary"
        }`}
      >
        {number}
      </span>
      <p className="max-w-[65vw] text-[2.05vw] leading-[1.18] text-text">{children}</p>
    </div>
  );
}

export function CornerMark({ className = "" }: { className?: string }) {
  return (
    <div className={`absolute h-[4vh] w-[4vh] ${className}`}>
      <div className="absolute left-0 top-0 h-[0.2vh] w-full bg-primary" />
      <div className="absolute left-0 top-0 h-full w-[0.2vh] bg-primary" />
    </div>
  );
}

export function Node({
  label,
  detail,
  tone = "cyan",
}: {
  label: string;
  detail: string;
  tone?: "cyan" | "amber";
}) {
  return (
    <div
      className={`deck-panel flex min-h-[17vh] flex-col justify-between p-[1.5vw] ${
        tone === "amber" ? "deck-panel-amber" : ""
      }`}
    >
      <div
        className={`h-[1.1vh] w-[1.1vh] ${
          tone === "amber" ? "bg-amber" : "bg-primary"
        }`}
      />
      <div>
        <div className="deck-display text-[2.2vw] font-semibold leading-none text-text">
          {label}
        </div>
        <div className="mt-[1.1vh] text-[1.25vw] leading-[1.35] text-muted">
          {detail}
        </div>
      </div>
    </div>
  );
}

export function FooterTag({ children }: { children: ReactNode }) {
  return (
    <div className="deck-mono absolute bottom-[4.5vh] left-[6vw] text-[0.95vw] text-muted">
      {children}
    </div>
  );
}