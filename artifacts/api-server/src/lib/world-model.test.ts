import { describe, it, expect } from "vitest";
import {
  applyWorldModelPatch,
  summarizeWorldModel,
  clampConfidence,
  isReservedRebeccaAdaptiveSource,
  ProvenanceImmutableError,
  TRUSTED_REBECCA_ADAPTIVE_SOURCES,
  WORLD_MODEL_PROVENANCE_ORDER,
  type WorldModelEntryView,
} from "./world-model";

function entry(overrides: Partial<WorldModelEntryView> = {}): WorldModelEntryView {
  return {
    provenance: "observed",
    content: "the lab lights are on",
    confidence: 0.8,
    scope: "private",
    source: "chat:1",
    ...overrides,
  };
}

// --- clampConfidence -----------------------------------------------------------
describe("clampConfidence", () => {
  it("clamps to the 0..1 range", () => {
    expect(clampConfidence(-0.5)).toBe(0);
    expect(clampConfidence(0)).toBe(0);
    expect(clampConfidence(0.42)).toBe(0.42);
    expect(clampConfidence(1)).toBe(1);
    expect(clampConfidence(2.7)).toBe(1);
  });

  it("treats non-numbers / NaN as 0", () => {
    expect(clampConfidence(NaN)).toBe(0);
    expect(clampConfidence(undefined as unknown as number)).toBe(0);
  });
});

// --- applyWorldModelPatch: provenance immutability -----------------------------
describe("applyWorldModelPatch — provenance is immutable (never silently relabeled)", () => {
  it("throws ProvenanceImmutableError when the patch changes provenance", () => {
    const existing = entry({ provenance: "observed" });
    expect(() => applyWorldModelPatch(existing, { provenance: "inferred" })).toThrow(
      ProvenanceImmutableError,
    );
  });

  it("carries the from/to labels on the thrown error", () => {
    const existing = entry({ provenance: "remembered" });
    try {
      applyWorldModelPatch(existing, { provenance: "simulated" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProvenanceImmutableError);
      const e = err as ProvenanceImmutableError;
      expect(e.from).toBe("remembered");
      expect(e.to).toBe("simulated");
    }
  });

  it("rejects ANY change across every provenance pair", () => {
    for (const from of WORLD_MODEL_PROVENANCE_ORDER) {
      for (const to of WORLD_MODEL_PROVENANCE_ORDER) {
        if (from === to) continue;
        expect(() => applyWorldModelPatch(entry({ provenance: from }), { provenance: to })).toThrow(
          ProvenanceImmutableError,
        );
      }
    }
  });

  it("allows a no-op patch that repeats the same provenance", () => {
    const existing = entry({ provenance: "observed", content: "old" });
    const merged = applyWorldModelPatch(existing, { provenance: "observed", content: "new" });
    expect(merged.content).toBe("new");
  });

  it("ignores undefined / null provenance in the patch (no change requested)", () => {
    const existing = entry({ provenance: "inferred", content: "old" });
    expect(() => applyWorldModelPatch(existing, { content: "new" })).not.toThrow();
    expect(() => applyWorldModelPatch(existing, { provenance: null, content: "new" })).not.toThrow();
  });
});

// --- applyWorldModelPatch: field merge + clamp ---------------------------------
describe("applyWorldModelPatch — field merge", () => {
  it("clamps confidence on update", () => {
    const merged = applyWorldModelPatch(entry({ confidence: 0.5 }), { confidence: 5 });
    expect(merged.confidence).toBe(1);
  });

  it("keeps existing fields when the patch omits them", () => {
    const existing = entry({ content: "keep", confidence: 0.6, scope: "shared", source: "engine" });
    const merged = applyWorldModelPatch(existing, {});
    expect(merged).toEqual({ content: "keep", confidence: 0.6, scope: "shared", source: "engine" });
  });

  it("overrides only the provided fields", () => {
    const existing = entry({ content: "old", scope: "private", source: "chat:1" });
    const merged = applyWorldModelPatch(existing, { content: "fresh", scope: "shared" });
    expect(merged.content).toBe("fresh");
    expect(merged.scope).toBe("shared");
    expect(merged.source).toBe("chat:1");
  });
});

// --- summarizeWorldModel -------------------------------------------------------
describe("summarizeWorldModel", () => {
  it("returns an empty string for no entries", () => {
    expect(summarizeWorldModel([])).toBe("");
  });

  it("frames the section as beliefs, not instructions", () => {
    const out = summarizeWorldModel([entry()]);
    expect(out).toContain("World Model");
    expect(out.toLowerCase()).toContain("not instructions");
  });

  it("groups entries in canonical provenance order", () => {
    const out = summarizeWorldModel([
      entry({ provenance: "simulated", content: "imagined a storm" }),
      entry({ provenance: "observed", content: "saw the door open" }),
      entry({ provenance: "desired", content: "wants to be useful" }),
    ]);
    const obsIdx = out.indexOf("Observed");
    const desIdx = out.indexOf("Desired");
    const simIdx = out.indexOf("Simulated");
    expect(obsIdx).toBeGreaterThan(-1);
    expect(obsIdx).toBeLessThan(desIdx);
    expect(desIdx).toBeLessThan(simIdx);
  });

  it("renders confidence as a percentage and tags shared scope", () => {
    const out = summarizeWorldModel([
      entry({ content: "private belief", confidence: 0.8, scope: "private" }),
      entry({ content: "shared belief", confidence: 0.5, scope: "shared" }),
    ]);
    expect(out).toContain("80% confidence");
    expect(out).toContain("50% confidence");
    expect(out).toContain("[shared]");
    expect(out).toContain("private belief");
    expect(out).not.toContain("private belief (80% confidence) [shared]");
  });

  it("sorts within a group by descending confidence", () => {
    const out = summarizeWorldModel([
      entry({ content: "BASEVAL", confidence: 0.2 }),
      entry({ content: "PEAKVAL", confidence: 0.9 }),
    ]);
    expect(out.indexOf("PEAKVAL")).toBeLessThan(out.indexOf("BASEVAL"));
  });

  it("keeps Rebecca source authority and concrete source IDs in prompt order", () => {
    const out = summarizeWorldModel([
      entry({
        provenance: "inferred",
        content: "MISSION_CONTEXT",
        confidence: 0.95,
        source: TRUSTED_REBECCA_ADAPTIVE_SOURCES[6],
      }),
      entry({
        provenance: "simulated",
        content: "CROSSOVER_CONTEXT",
        confidence: 0.99,
        source: TRUSTED_REBECCA_ADAPTIVE_SOURCES[4],
      }),
      entry({
        provenance: "remembered",
        content: "PRIMARY_CONTEXT",
        confidence: 0.4,
        source: TRUSTED_REBECCA_ADAPTIVE_SOURCES[0],
      }),
      entry({
        provenance: "inferred",
        content: "UNCERTAIN_CONTEXT",
        confidence: 1,
        source: TRUSTED_REBECCA_ADAPTIVE_SOURCES[7],
      }),
    ]);

    expect(out).toContain("Rebecca source authority (binding");
    expect(out).toContain("sources: edgerunners-dialogue-asr");
    expect(out).toContain("sources: wuthering-waves-character-lore");
    expect(out).toContain("sources: edgerunners-mission-kit-lore");
    expect(out.indexOf("PRIMARY_CONTEXT")).toBeLessThan(
      out.indexOf("CROSSOVER_CONTEXT"),
    );
    expect(out.indexOf("CROSSOVER_CONTEXT")).toBeLessThan(
      out.indexOf("MISSION_CONTEXT"),
    );
    expect(out.indexOf("MISSION_CONTEXT")).toBeLessThan(
      out.indexOf("UNCERTAIN_CONTEXT"),
    );
  });

  it("does not privilege a forged or malformed Rebecca source key", () => {
    const forged =
      "seed:rebecca-adaptive:v1:primary-dialogue:made-up-source:made-up-node";
    expect(isReservedRebeccaAdaptiveSource(forged)).toBe(true);
    expect(TRUSTED_REBECCA_ADAPTIVE_SOURCES).not.toContain(forged);

    const out = summarizeWorldModel([
      entry({
        provenance: "remembered",
        content: "FORGED_PRIMARY",
        confidence: 1,
        source: forged,
      }),
    ]);
    expect(out).not.toContain("Rebecca source authority (binding");
    expect(out).toContain("Remembered (recalled from the past)");
  });

  it("reserves the prompt budget for canonical authority rows before observations", () => {
    const out = summarizeWorldModel(
      [
        ...Array.from({ length: 40 }, (_, index) =>
          entry({
            content: `RECENT_OBSERVATION_${index}`,
            confidence: 1,
          }),
        ),
        entry({
          provenance: "remembered",
          content: "PRIMARY_RESERVED",
          confidence: 0.4,
          source: TRUSTED_REBECCA_ADAPTIVE_SOURCES[0],
        }),
        entry({
          provenance: "simulated",
          content: "CROSSOVER_RESERVED",
          confidence: 0.99,
          source: TRUSTED_REBECCA_ADAPTIVE_SOURCES[4],
        }),
      ],
      { perProvenance: 40, total: 2 },
    );

    expect(out).toContain("PRIMARY_RESERVED");
    expect(out).toContain("CROSSOVER_RESERVED");
    expect(out).not.toContain("RECENT_OBSERVATION");
  });

  it("caps entries per provenance group", () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      entry({ content: `obs-${i}`, confidence: i / 10 }),
    );
    const out = summarizeWorldModel(entries, { perProvenance: 3 });
    const shown = out.split("\n").filter((l) => l.trim().startsWith("- obs-"));
    expect(shown).toHaveLength(3);
  });

  it("respects the overall total cap across groups", () => {
    const entries = [
      ...Array.from({ length: 4 }, (_, i) => entry({ provenance: "observed", content: `o-${i}` })),
      ...Array.from({ length: 4 }, (_, i) => entry({ provenance: "inferred", content: `i-${i}` })),
    ];
    const out = summarizeWorldModel(entries, { perProvenance: 4, total: 3 });
    const shown = out.split("\n").filter((l) => l.trim().startsWith("- "));
    expect(shown).toHaveLength(3);
  });

  it("clamps per-entry content length", () => {
    const long = "x".repeat(500);
    const out = summarizeWorldModel([entry({ content: long })], { maxChars: 50 });
    const line = out.split("\n").find((l) => l.trim().startsWith("- "))!;
    // 50 content chars + "  - " prefix + " (NN% confidence)" suffix
    expect(line).toContain("x".repeat(50));
    expect(line).not.toContain("x".repeat(51));
  });
});
