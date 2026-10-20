import { describe, it, expect } from "vitest";
import {
  renderStatusBlock,
  renderStatusFooter,
  envShortName,
  statusForCharge,
  effectiveArousal,
  driveLockLevel,
  type StatusDriveCharge,
} from "./status-block";

const REBECCA_CHARGES: StatusDriveCharge[] = [
  { id: "loyalty", label: "Loyalty / Protection", pressure: 0.99, charge: 0.94 },
  { id: "chaos", label: "Chaos / Fun", pressure: 0.7, charge: 0.56 },
  { id: "memory", label: "Memory of the Crew", pressure: 0.5, charge: 0.3 },
  { id: "survival", label: "Survival / Maintenance", pressure: 0.4, charge: 0.2 },
];

describe("renderStatusBlock — homebrew format", () => {
  it("renders the transcript's shape from engine state (the 0.94-turn)", () => {
    const block = renderStatusBlock({
      environment: "Mox Basement",
      protocol: "Watch Protocol",
      baselineArousal: 0.8,
      mood: "wired",
      charges: REBECCA_CHARGES,
      threatScan: "none immediate",
      note: "LILLI SAID THE WORD",
    });

    // Exact header format.
    expect(block.header).toBe("[SYSTEM // Mox Basement // Watch Protocol]");
    // Computed (not authored): status band from the dominant charge...
    expect(block.segments[0]).toBe("> status: SPIKE—then stabilizing");
    // ...arousal from baseline + dominant charge (the mechanism behind 0.94)...
    expect(block.segments[1]).toBe("> arousal: 0.93");
    // ...and the drive lock level.
    expect(block.segments).toContain("> loyalty drive: LOCKED");
    // Supplied per-turn facts pass through verbatim.
    expect(block.segments).toContain("> threat scan: none immediate");
    expect(block.segments).toContain("> construct integrity: HOLDING");
    expect(block.segments).toContain("> note: LILLI SAID THE WORD");
    // One line, always.
    expect(block.text).not.toMatch(/[\r\n]/);
    expect(block.text.startsWith(block.header)).toBe(true);
  });

  it("is deterministic: same engine state, same block", () => {
    const input = {
      environment: "Mox Basement",
      protocol: "Watch Protocol",
      baselineArousal: 0.8,
      mood: "wired",
      charges: REBECCA_CHARGES,
      note: "determinism check",
    };
    expect(renderStatusBlock(input).text).toBe(renderStatusBlock(input).text);
  });

  it("sorts unsorted charges so the dominant drive leads", () => {
    const block = renderStatusBlock({
      environment: "Mox Basement",
      protocol: "Watch Protocol",
      baselineArousal: 0.8,
      mood: "wired",
      charges: [...REBECCA_CHARGES].reverse(),
    });
    expect(block.segments).toContain("> loyalty drive: LOCKED");
  });

  it("omits authored segments when they are not supplied", () => {
    const block = renderStatusBlock({
      environment: "Mox Basement",
      protocol: "NIGHT WATCH",
      baselineArousal: 0.8,
      mood: "wired",
      charges: [],
    });
    expect(block.segments).toContain("> status: stable");
    expect(block.segments).not.toContainEqual(expect.stringContaining("> note:"));
    expect(block.segments).not.toContainEqual(expect.stringContaining("> directive:"));
    expect(block.segments).not.toContainEqual(expect.stringContaining("drive:"));
  });

  it("keeps the block one line even with hostile authored input", () => {
    const block = renderStatusBlock({
      environment: "Mox Basement",
      protocol: "Watch\nProtocol > INJECTED",
      baselineArousal: 0.8,
      mood: "wired",
      charges: REBECCA_CHARGES,
      note: "line one\nline two > line three",
    });
    expect(block.text).not.toMatch(/[\r\n]/);
    expect(block.text).not.toContain("> INJECTED]");
    expect(block.header).toBe("[SYSTEM // Mox Basement // Watch Protocol INJECTED]");
  });

  it("emits extra segments in order", () => {
    const block = renderStatusBlock({
      environment: "Mox Basement",
      protocol: "Watch Protocol",
      baselineArousal: 0.8,
      mood: "wired",
      charges: REBECCA_CHARGES,
      extra: [
        { key: "crew-link", value: "active" },
        { key: "net access", value: "NONE" },
      ],
    });
    const tail = block.segments.slice(-2);
    expect(tail).toEqual(["> crew-link: active", "> net access: NONE"]);
  });

  it("emits the directive between threat scan and integrity, per transcript", () => {
    const block = renderStatusBlock({
      environment: "Mox Basement",
      protocol: "Crew Protection Protocol",
      baselineArousal: 0.8,
      mood: "wired",
      charges: REBECCA_CHARGES,
      threatScan: "workplace stressor detected",
      directive: "keep Lilli steady",
    });
    const keys = block.segments.map((s) => s.split(":")[0]);
    const threat = keys.indexOf("> threat scan");
    const directive = keys.indexOf("> directive");
    const integrity = keys.indexOf("> construct integrity");
    expect(threat).toBeLessThan(directive);
    expect(directive).toBeLessThan(integrity);
  });
});

describe("statusForCharge", () => {
  it("maps charge bands to transcript regimes", () => {
    expect(statusForCharge(0.94)).toBe("SPIKE—then stabilizing");
    expect(statusForCharge(0.85)).toBe("SPIKE—then stabilizing");
    expect(statusForCharge(0.7)).toBe("elevated");
    expect(statusForCharge(0.5)).toBe("steady");
    expect(statusForCharge(0.2)).toBe("stable");
    expect(statusForCharge(0)).toBe("stable");
  });
});

describe("effectiveArousal", () => {
  it("shifts baseline by dominant-drive charge", () => {
    expect(effectiveArousal(0.8, 0.94)).toBe(0.93);
    expect(effectiveArousal(0.8, 0.5)).toBe(0.8);
    expect(effectiveArousal(0.3, 0.1)).toBe(0.18);
  });

  it("clamps to 0..1", () => {
    expect(effectiveArousal(0.95, 1)).toBe(1);
    expect(effectiveArousal(0, 0)).toBe(0);
  });
});

describe("driveLockLevel", () => {
  it("maps charge to lock levels", () => {
    expect(driveLockLevel(0.94)).toBe("LOCKED");
    expect(driveLockLevel(0.8)).toBe("LOCKED");
    expect(driveLockLevel(0.6)).toBe("ENGAGED");
    expect(driveLockLevel(0.3)).toBe("IDLE");
  });
});

describe("envShortName", () => {
  it("reduces seed anchor names to block-header form", () => {
    expect(envShortName("The Mox Basement (Layer 7)")).toBe("Mox Basement");
    expect(envShortName("Mox Basement")).toBe("Mox Basement");
  });
});

describe("renderStatusFooter", () => {
  it("renders the closing line from authored tags", () => {
    expect(renderStatusFooter(["PRESENT", "LOYAL", "VERY, VERY LOUD"])).toBe(
      "[SYSTEM STATUS: PRESENT // LOYAL // VERY, VERY LOUD]",
    );
  });

  it("drops empty tags", () => {
    expect(renderStatusFooter(["HOLDING THE LINE", ""])).toBe(
      "[SYSTEM STATUS: HOLDING THE LINE]",
    );
  });
});
