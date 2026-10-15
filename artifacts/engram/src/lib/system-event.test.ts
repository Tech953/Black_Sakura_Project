import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import type { EngramEvent } from "../hooks/use-event-stream";
import { describeSystemEvent } from "./system-event";

function createTranslator() {
  const calls: Array<{ key: string; options?: Record<string, unknown> }> = [];
  const translate = (key: string, options?: Record<string, unknown>) => {
    calls.push({ key, options });
    return key;
  };
  return { t: translate as unknown as TFunction, calls };
}

function controlsEvent(paused: boolean, quietMode: boolean): EngramEvent {
  return {
    type: "controls.changed",
    ts: "2026-10-07T12:00:00.000Z",
    data: {
      id: 1,
      paused,
      quietMode,
      updatedAt: "2026-10-07T12:00:00.000Z",
    },
  };
}

describe("describeSystemEvent controls.changed", () => {
  it("renders paused and quiet flags from the serialized controls payload", () => {
    const { t, calls } = createTranslator();

    expect(describeSystemEvent(controlsEvent(true, true), t)).toEqual({
      label: "eventControlsUpdated",
      tone: "warn",
    });
    expect(calls.map((call) => call.key)).toEqual([
      "eventControlsPaused",
      "eventControlsQuiet",
      "eventControlsUpdated",
    ]);
    expect(calls[2]?.options).toEqual({
      bits: "eventControlsPaused, eventControlsQuiet",
    });
  });

  it("renders the active state when paused and quiet mode are both disabled", () => {
    const { t, calls } = createTranslator();

    expect(describeSystemEvent(controlsEvent(false, false), t)).toEqual({
      label: "eventControlsUpdated",
      tone: "warn",
    });
    expect(calls.map((call) => call.key)).toEqual([
      "eventControlsActive",
      "eventControlsUpdated",
    ]);
    expect(calls[1]?.options).toEqual({ bits: "eventControlsActive" });
  });
});
