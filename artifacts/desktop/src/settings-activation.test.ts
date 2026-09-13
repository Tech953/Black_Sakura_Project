import { describe, expect, it, vi } from "vitest";
import {
  activateSettings,
  SettingsActivationError,
  type SettingsActivationDependencies,
} from "./settings-activation";

function dependencies(
  order: string[],
): SettingsActivationDependencies<string> {
  return {
    stop: vi.fn(async () => {
      order.push("stop");
    }),
    start: vi.fn(async (settings) => {
      order.push(`start:${settings}`);
    }),
    persist: vi.fn(async (settings) => {
      order.push(`persist:${settings}`);
    }),
  };
}

describe("activateSettings", () => {
  it("stops, health-starts candidate, then and only then persists", async () => {
    const order: string[] = [];
    const deps = dependencies(order);
    await activateSettings("old", "new", deps);
    expect(order).toEqual(["stop", "start:new", "persist:new"]);
  });

  it("does not persist candidate and restarts previous after start failure", async () => {
    const order: string[] = [];
    const deps = dependencies(order);
    vi.mocked(deps.start)
      .mockImplementationOnce(async () => {
        order.push("start:new");
        throw new Error("unhealthy");
      })
      .mockImplementationOnce(async () => {
        order.push("start:old");
      });

    await expect(activateSettings("old", "new", deps)).rejects.toMatchObject({
      primaryError: expect.objectContaining({ message: "unhealthy" }),
      rollbackErrors: [],
    });
    expect(order).toEqual(["stop", "start:new", "stop", "start:old"]);
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it("keeps a structured local-model failure attached for Settings recovery", async () => {
    const order: string[] = [];
    const failure = Object.assign(
      new Error("The built-in local model is missing Linux runtime libraries."),
      {
        localModelFailure: {
          code: "missing-linux-dependencies",
          platform: "linux",
          message:
            "The built-in local model is missing Linux runtime libraries.",
          missingLibraries: ["libgomp.so.1"],
          automaticFixAvailable: false,
        },
      },
    );
    const deps = dependencies(order);
    vi.mocked(deps.start)
      .mockRejectedValueOnce(failure)
      .mockImplementationOnce(async (settings) => {
        order.push(`start:${settings}`);
      });

    const activationError = await activateSettings("old", "new", deps).catch(
      (error: unknown) => error,
    );

    expect(activationError).toMatchObject({
      primaryError: {
        localModelFailure: {
          code: "missing-linux-dependencies",
          missingLibraries: ["libgomp.so.1"],
        },
      },
    });
    expect(order).toEqual(["stop", "stop", "start:old"]);
  });

  it("rolls runtime and disk back when persistence fails", async () => {
    const order: string[] = [];
    const deps = dependencies(order);
    vi.mocked(deps.persist)
      .mockImplementationOnce(async () => {
        order.push("persist:new");
        throw new Error("disk failed");
      })
      .mockImplementationOnce(async () => {
        order.push("persist:old");
      });

    await expect(activateSettings("old", "new", deps)).rejects.toBeInstanceOf(
      SettingsActivationError,
    );
    expect(order).toEqual([
      "stop",
      "start:new",
      "persist:new",
      "stop",
      "start:old",
      "persist:old",
    ]);
  });

  it("reports primary and every rollback failure", async () => {
    const deps: SettingsActivationDependencies<string> = {
      stop: vi
        .fn<() => Promise<void>>()
        .mockResolvedValueOnce()
        .mockRejectedValueOnce(new Error("candidate stop failed")),
      start: vi
        .fn<(settings: string) => Promise<void>>()
        .mockRejectedValueOnce(new Error("candidate failed"))
        .mockRejectedValueOnce(new Error("previous failed")),
      persist: vi.fn(),
    };
    const error = await activateSettings("old", "new", deps).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SettingsActivationError);
    expect(error).toMatchObject({
      primaryError: expect.objectContaining({ message: "candidate failed" }),
      rollbackErrors: [
        expect.objectContaining({ message: "candidate stop failed" }),
        expect.objectContaining({ message: "previous failed" }),
      ],
    });
    expect((error as Error).message).toContain("rollback failed");
  });
});