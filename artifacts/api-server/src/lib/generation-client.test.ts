import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  generationConfigured,
  generateImage,
  generateVideo,
  GenerationUnavailableError,
} from "./generation-client";
import {
  generateArtifact,
  ProviderUnavailableError,
} from "./artifact-generation";
import type { Engram } from "@workspace/db";

// The seam resolves its endpoint from these env vars (first defined wins). Clear all
// of them so the "offline" assertions are deterministic regardless of the host env,
// and restore afterward so we never leak state into other suites.
const PROVIDER_ENV = [
  "GENERATION_BASE_URL",
  "GENERATION_API_KEY",
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "AI_INTEGRATIONS_OPENAI_BASE_URL",
  "AI_INTEGRATIONS_OPENAI_API_KEY",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of PROVIDER_ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of PROVIDER_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// buildVisualPrompt only reads title/prompt/worldModelSummary, never engram fields,
// so a minimal cast is enough to drive the offline path without a full fixture.
const fakeEngram = { id: 1, name: "Test" } as unknown as Engram;

describe("generation seam — offline / fail-closed", () => {
  it("reports unconfigured and throws GenerationUnavailableError when no provider env is set", async () => {
    expect(generationConfigured()).toBe(false);
    await expect(
      generateImage("a quiet harbor at dawn"),
    ).rejects.toBeInstanceOf(GenerationUnavailableError);
    await expect(
      generateVideo("a quiet harbor at dawn"),
    ).rejects.toBeInstanceOf(GenerationUnavailableError);
  });

  it("reports configured once any base URL resolves", () => {
    expect(generationConfigured()).toBe(false);
    process.env.GENERATION_BASE_URL = "https://example.invalid/v1";
    expect(generationConfigured()).toBe(true);
    delete process.env.GENERATION_BASE_URL;

    // The shared LLM seam also satisfies generation.
    process.env.LLM_BASE_URL = "https://example.invalid/v1";
    expect(generationConfigured()).toBe(true);
  });

  it("blocks external generation requests before they reach a provider", async () => {
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL =
      "https://api.example.invalid/v1";

    await expect(generateImage("a quiet harbor at dawn")).rejects.toThrow(
      "Connection error",
    );
    await expect(generateVideo("a quiet harbor at dawn")).rejects.toThrow(
      "Connection error",
    );
  });

  it("blocks direct external requests when no provider is configured", async () => {
    expect(generationConfigured()).toBe(false);
    await expect(
      fetch("https://api.example.invalid/v1/models"),
    ).rejects.toThrow("[api-test-network] blocked external HTTP request");
  });

  it("surfaces image/video generation offline as ProviderUnavailableError (fail-closed, never a crash)", async () => {
    await expect(
      generateArtifact({
        engram: fakeEngram,
        kind: "image",
        title: "Harbor",
        prompt: "dawn",
      }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(
      generateArtifact({
        engram: fakeEngram,
        kind: "video",
        title: "Harbor",
        prompt: "dawn",
      }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});
