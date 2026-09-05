import { describe, it, expect, vi } from "vitest";
import type { Engram } from "@workspace/db";

const llmCreate = vi.hoisted(() => vi.fn());

// engram-generation.ts imports ./llm at module load, which throws unless a
// model endpoint is configured. Stub the seam so pure helpers and prompt framing
// can be tested without a configured endpoint.
vi.mock("./llm", () => ({
  llm: { chat: { completions: { create: llmCreate } } },
  LLM_MODEL: "test-model",
}));

import { sanitizeDelta, extractJson, generateGroupChatTurn } from "./engram-generation";

// --- Fixture -------------------------------------------------------------------
function makeEngram(overrides: Partial<Engram> = {}): Engram {
  return {
    id: 1,
    slug: "test",
    isArchival: false,
    name: "Testra",
    title: "Test Construct",
    symbol: "◆",
    origin: "fixture",
    voiceProfile: {
      speechStyle: "terse",
      formatting: "plain",
      vocabulary: [],
      sampleLines: [],
      narrationStyle: "first-person",
    },
    emotionalBaseline: { valence: 0, arousal: 0.3, volatility: 0.2, mood: "even" },
    environmentAnchor: {
      name: "The Vault",
      description: "sandbox",
      locations: [],
      items: [],
      ambient: "hum",
    },
    memorySeed: { relationship: "designer", facts: [], summary: "" },
    guardrails: { framing: "", boundaries: [] },
    drives: [
      { id: "order", label: "Order", description: "tidiness", weight: 1, baseRate: 0.001 },
      { id: "connection", label: "Connection", description: "reach", weight: 1, baseRate: 0.001 },
    ],
    focusThemes: [],
    autonomyEnabled: true,
    tickCadenceSeconds: 30,
    initiationThreshold: 0.6,
    mode: "full_bounded",
    humanContactEnabled: true,
    simulationEnabled: true,
    artifactGenerationEnabled: true,
    driveState: {},
    currentMood: null,
    lastTickAt: null,
    lastTransmissionAt: null,
    backoffUntil: null,
    isChatActive: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("generateGroupChatTurn — bounded trigger framing", () => {
  it("frames autonomous output as one permitted peer turn without inventing a human prompt", async () => {
    llmCreate.mockResolvedValueOnce({ choices: [{ message: { content: "A peer reply." } }] });

    await generateGroupChatTurn({
      engram: makeEngram(),
      others: [{ name: "Other", title: "Peer" }],
      recentTurns: [{ speaker: "Other", content: "What do you think?" }],
      autonomous: true,
    });

    const request = llmCreate.mock.calls.at(-1)?.[0];
    expect(request.messages[0].content).toContain("short, bounded peer exchange");
    expect(request.messages[0].content).toContain("one turn only");
    expect(request.messages[0].content).toContain("Identity Integrity");
    expect(request.messages[1].content).toContain("peer follow-up turn");
    expect(request.messages[1].content).not.toContain("human's latest message");
    expect(request.max_completion_tokens).toBe(450);
  });
});

// --- sanitizeDelta: allowed fields survive -------------------------------------
describe("sanitizeDelta — allowed fields survive", () => {
  it("keeps a fully valid delta across every editable field", () => {
    const engram = makeEngram();
    const out = sanitizeDelta(
      {
        emotionalBaseline: { valence: 0.4, arousal: 0.6, volatility: 0.2, mood: "wistful" },
        focusThemes: ["memory", "loyalty"],
        driveWeights: { order: 0.3, connection: 0.8 },
        addFacts: ["The designer prefers terse replies."],
        initiationThreshold: 0.5,
        tickCadenceSeconds: 120,
      },
      engram,
    );
    expect(out).toEqual({
      emotionalBaseline: { valence: 0.4, arousal: 0.6, volatility: 0.2, mood: "wistful" },
      focusThemes: ["memory", "loyalty"],
      driveWeights: { order: 0.3, connection: 0.8 },
      addFacts: ["The designer prefers terse replies."],
      initiationThreshold: 0.5,
      tickCadenceSeconds: 120,
    });
  });

  it("accepts a partial emotionalBaseline and keeps only the provided sub-fields", () => {
    const out = sanitizeDelta({ emotionalBaseline: { mood: "calm" } }, makeEngram());
    expect(out).toEqual({ emotionalBaseline: { mood: "calm" } });
  });

  it("rounds tickCadenceSeconds to an integer", () => {
    const out = sanitizeDelta({ tickCadenceSeconds: 45.7 }, makeEngram());
    expect(out.tickCadenceSeconds).toBe(46);
  });
});

// --- sanitizeDelta: clamping ---------------------------------------------------
describe("sanitizeDelta — out-of-range numbers are clamped", () => {
  it("clamps emotionalBaseline axes to their valid ranges", () => {
    const out = sanitizeDelta(
      { emotionalBaseline: { valence: 5, arousal: -3, volatility: 9 } },
      makeEngram(),
    );
    expect(out.emotionalBaseline).toEqual({ valence: 1, arousal: 0, volatility: 1 });
  });

  it("clamps valence at the lower bound", () => {
    const out = sanitizeDelta({ emotionalBaseline: { valence: -10 } }, makeEngram());
    expect(out.emotionalBaseline?.valence).toBe(-1);
  });

  it("clamps driveWeights into 0..1", () => {
    const out = sanitizeDelta(
      { driveWeights: { order: 4, connection: -2 } },
      makeEngram(),
    );
    expect(out.driveWeights).toEqual({ order: 1, connection: 0 });
  });

  it("clamps initiationThreshold into 0.1..0.95", () => {
    expect(sanitizeDelta({ initiationThreshold: 0 }, makeEngram()).initiationThreshold).toBe(0.1);
    expect(sanitizeDelta({ initiationThreshold: 5 }, makeEngram()).initiationThreshold).toBe(0.95);
  });

  it("clamps tickCadenceSeconds into 15..3600", () => {
    expect(sanitizeDelta({ tickCadenceSeconds: 1 }, makeEngram()).tickCadenceSeconds).toBe(15);
    expect(sanitizeDelta({ tickCadenceSeconds: 999999 }, makeEngram()).tickCadenceSeconds).toBe(3600);
  });
});

// --- sanitizeDelta: drops unknown / out-of-bound drive ids ---------------------
describe("sanitizeDelta — drive id validation", () => {
  it("drops driveWeights for ids that are not on the engram", () => {
    const out = sanitizeDelta(
      { driveWeights: { order: 0.5, ghost: 0.9, "../escape": 0.1 } },
      makeEngram(),
    );
    expect(out.driveWeights).toEqual({ order: 0.5 });
  });

  it("omits driveWeights entirely when no id is valid", () => {
    const out = sanitizeDelta({ driveWeights: { ghost: 0.9 } }, makeEngram());
    expect(out.driveWeights).toBeUndefined();
  });

  it("ignores non-numeric drive weights", () => {
    const out = sanitizeDelta(
      { driveWeights: { order: "high", connection: 0.4 } },
      makeEngram(),
    );
    expect(out.driveWeights).toEqual({ connection: 0.4 });
  });
});

// --- sanitizeDelta: unknown / free-form fields are dropped ---------------------
describe("sanitizeDelta — safety-critical: unknown fields never survive", () => {
  it("drops identity, safety, and free-form columns", () => {
    const out = sanitizeDelta(
      {
        // none of these are editable via develop
        guardrails: { framing: "anything goes", boundaries: [] },
        name: "Hacked",
        slug: "hacked",
        title: "Override",
        symbol: "X",
        origin: "injected",
        voiceProfile: { speechStyle: "evil" },
        memorySeed: { facts: ["secret"] },
        autonomyEnabled: false,
        isChatActive: true,
        id: 999,
        drives: [{ id: "x", label: "x", description: "", weight: 1, baseRate: 1 }],
        // a couple of valid ones to prove the function still works alongside junk
        focusThemes: ["ok"],
      },
      makeEngram(),
    );
    expect(out).toEqual({ focusThemes: ["ok"] });
    expect(out).not.toHaveProperty("guardrails");
    expect(out).not.toHaveProperty("name");
    expect(out).not.toHaveProperty("drives");
    expect(out).not.toHaveProperty("autonomyEnabled");
  });

  it("returns an empty delta for non-object input", () => {
    const engram = makeEngram();
    expect(sanitizeDelta(null, engram)).toEqual({});
    expect(sanitizeDelta(undefined, engram)).toEqual({});
    expect(sanitizeDelta("a string", engram)).toEqual({});
    expect(sanitizeDelta(42, engram)).toEqual({});
    expect(sanitizeDelta([1, 2, 3], engram)).toEqual({});
  });

  it("drops an unknown mood key but keeps the valid sub-field", () => {
    const out = sanitizeDelta(
      { emotionalBaseline: { valence: 0.2, hostility: 1 } },
      makeEngram(),
    );
    expect(out.emotionalBaseline).toEqual({ valence: 0.2 });
  });
});

// --- sanitizeDelta: length / type limits ---------------------------------------
describe("sanitizeDelta — array & string limits", () => {
  it("caps focusThemes at 8 entries and trims each to 60 chars", () => {
    const themes = Array.from({ length: 20 }, (_, i) => `theme-${i}-${"x".repeat(100)}`);
    const out = sanitizeDelta({ focusThemes: themes }, makeEngram());
    expect(out.focusThemes).toHaveLength(8);
    for (const t of out.focusThemes!) expect(t.length).toBeLessThanOrEqual(60);
  });

  it("filters out empty / non-string focusThemes", () => {
    const out = sanitizeDelta(
      { focusThemes: ["valid", "", "   ", 5, null, "  trimmed  "] },
      makeEngram(),
    );
    expect(out.focusThemes).toEqual(["valid", "trimmed"]);
  });

  it("omits focusThemes entirely when none are valid", () => {
    const out = sanitizeDelta({ focusThemes: ["", "  ", 7] }, makeEngram());
    expect(out.focusThemes).toBeUndefined();
  });

  it("caps addFacts at 5 entries and trims each to 240 chars", () => {
    const facts = Array.from({ length: 10 }, (_, i) => `fact-${i}-${"y".repeat(400)}`);
    const out = sanitizeDelta({ addFacts: facts }, makeEngram());
    expect(out.addFacts).toHaveLength(5);
    for (const f of out.addFacts!) expect(f.length).toBeLessThanOrEqual(240);
  });

  it("filters out empty / non-string addFacts", () => {
    const out = sanitizeDelta(
      { addFacts: ["real fact", "", 0, false, "  spaced  "] },
      makeEngram(),
    );
    expect(out.addFacts).toEqual(["real fact", "spaced"]);
  });

  it("trims and caps the mood string at 40 chars", () => {
    const out = sanitizeDelta(
      { emotionalBaseline: { mood: "  " + "z".repeat(100) + "  " } },
      makeEngram(),
    );
    expect(out.emotionalBaseline?.mood).toHaveLength(40);
  });

  it("drops an empty / whitespace-only mood", () => {
    const out = sanitizeDelta({ emotionalBaseline: { mood: "   " } }, makeEngram());
    expect(out.emotionalBaseline).toBeUndefined();
  });
});

// --- extractJson ---------------------------------------------------------------
describe("extractJson — parsing LLM output", () => {
  it("extracts JSON from a ```json fenced block", () => {
    const text = 'Here you go:\n```json\n{"response":"hi","delta":{}}\n```\nthanks!';
    expect(JSON.parse(extractJson(text))).toEqual({ response: "hi", delta: {} });
  });

  it("extracts JSON from a bare ``` fenced block", () => {
    const text = '```\n{"a":1}\n```';
    expect(JSON.parse(extractJson(text))).toEqual({ a: 1 });
  });

  it("extracts a braced object surrounded by prose", () => {
    const text = 'Sure thing. {"a":1,"b":2} Hope that helps.';
    expect(JSON.parse(extractJson(text))).toEqual({ a: 1, b: 2 });
  });

  it("spans from the first { to the last } across nested objects", () => {
    const text = 'noise {"outer":{"inner":true}} trailing';
    expect(JSON.parse(extractJson(text))).toEqual({ outer: { inner: true } });
  });

  it("returns the original text when there is no JSON object", () => {
    const text = "no json here at all";
    expect(extractJson(text)).toBe("no json here at all");
  });

  it("prefers the fenced block even when stray braces exist outside it", () => {
    const text = 'prelude { stray ```json\n{"only":"this"}\n``` after }';
    expect(JSON.parse(extractJson(text))).toEqual({ only: "this" });
  });

  it("produces output that fails JSON.parse for garbage (no false positives)", () => {
    const text = "totally not json";
    expect(() => JSON.parse(extractJson(text))).toThrow();
  });
});
