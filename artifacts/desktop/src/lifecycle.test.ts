import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  stopProcess,
  installDownloadedUpdate,
  stopDesktopWork,
  STOP_TIMEOUT_MS,
  type StoppableProcess,
} from "./lifecycle";

// A controllable fake of the server child process: records the signals it was
// sent and lets the test decide whether/when it "exits".
class FakeProcess extends EventEmitter implements StoppableProcess {
  killed: NodeJS.Signals[] = [];
  // When true, sending SIGTERM makes the process exit on the next microtask
  // (the well-behaved case). When false, it never exits on its own, forcing the
  // SIGKILL timeout fallback.
  constructor(private readonly exitOnTerm: boolean) {
    super();
  }
  kill(signal?: NodeJS.Signals | number): boolean {
    const sig = (signal ?? "SIGTERM") as NodeJS.Signals;
    this.killed.push(sig);
    if (sig === "SIGTERM" && this.exitOnTerm) {
      queueMicrotask(() => this.emit("exit", 0, null));
    }
    return true;
  }
}

describe("stopProcess (shared SIGTERM→SIGKILL shutdown)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves on graceful SIGTERM exit without escalating to SIGKILL", async () => {
    const proc = new FakeProcess(true);
    await stopProcess(proc, 5000);
    expect(proc.killed).toEqual(["SIGTERM"]);
    expect(proc.killed).not.toContain("SIGKILL");
  });

  it("escalates to SIGKILL when the process ignores SIGTERM", async () => {
    vi.useFakeTimers();
    const proc = new FakeProcess(false);
    const done = stopProcess(proc, STOP_TIMEOUT_MS);

    // Before the timeout only SIGTERM has been sent and the promise is pending.
    expect(proc.killed).toEqual(["SIGTERM"]);

    await vi.advanceTimersByTimeAsync(STOP_TIMEOUT_MS);
    await done;

    expect(proc.killed).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("swallows a kill() throw during the SIGKILL fallback and still resolves", async () => {
    vi.useFakeTimers();
    const proc = new FakeProcess(false);
    const killSpy = vi.spyOn(proc, "kill");
    // First call (SIGTERM) succeeds; the fallback SIGKILL throws ("already gone").
    killSpy.mockImplementationOnce(() => true).mockImplementationOnce(() => {
      throw new Error("ESRCH");
    });
    const done = stopProcess(proc, STOP_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(STOP_TIMEOUT_MS);
    await expect(done).resolves.toBeUndefined();
  });
});

describe("installDownloadedUpdate (DB-safe auto-update path)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("fully resolves stopServer() BEFORE quitAndInstall() is invoked", async () => {
    const order: string[] = [];
    let resolveStop: (() => void) | undefined;
    const stopServer = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          order.push("stop:start");
          resolveStop = () => {
            order.push("stop:resolved");
            resolve();
          };
        }),
    );
    const quitAndInstall = vi.fn(() => {
      order.push("quitAndInstall");
    });

    const installed = installDownloadedUpdate({
      stopServer,
      quitAndInstall,
      setAutoInstallOnAppQuit: vi.fn(),
      markQuitting: vi.fn(),
    });

    // The server stop has begun but is still pending — install must NOT have run.
    await Promise.resolve();
    expect(stopServer).toHaveBeenCalledTimes(1);
    expect(quitAndInstall).not.toHaveBeenCalled();

    // Now let the server finish shutting down.
    resolveStop?.();
    await installed;

    expect(quitAndInstall).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["stop:start", "stop:resolved", "quitAndInstall"]);
  });

  it("arms autoInstallOnAppQuit and marks quitting before stopping the server", async () => {
    const order: string[] = [];
    const setAutoInstallOnAppQuit = vi.fn((v: boolean) =>
      order.push(`autoInstall=${v}`),
    );
    const markQuitting = vi.fn(() => order.push("markQuitting"));
    const stopServer = vi.fn(async () => {
      order.push("stop");
    });
    const quitAndInstall = vi.fn(() => order.push("quitAndInstall"));

    await installDownloadedUpdate({
      stopServer,
      quitAndInstall,
      setAutoInstallOnAppQuit,
      markQuitting,
    });

    expect(setAutoInstallOnAppQuit).toHaveBeenCalledWith(true);
    expect(order).toEqual([
      "autoInstall=true",
      "markQuitting",
      "stop",
      "quitAndInstall",
    ]);
  });

  it("still installs if stopServer rejects, so a stop error can't wedge updates", async () => {
    const stopServer = vi.fn(async () => {
      throw new Error("stop failed");
    });
    const quitAndInstall = vi.fn();

    await expect(
      installDownloadedUpdate({
        stopServer,
        quitAndInstall,
        setAutoInstallOnAppQuit: vi.fn(),
        markQuitting: vi.fn(),
      }),
    ).rejects.toThrow("stop failed");

    // Even though stop rejected, the install still fired (finally block).
    expect(quitAndInstall).toHaveBeenCalledTimes(1);
  });
});

describe("stopDesktopWork", () => {
  it("cancels model imports before stopping the API and llama runtime", async () => {
    const order: string[] = [];
    await stopDesktopWork({
      stopImports: async () => {
        order.push("imports");
      },
      stopServer: async () => {
        order.push("server");
      },
      stopLlama: async () => {
        order.push("llama");
      },
    });
    expect(order).toEqual(["imports", "server", "llama"]);
  });
});
