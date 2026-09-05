// ---------------------------------------------------------------------------
// Pure, electron-free lifecycle helpers. Kept in their own module (no electron
// import) so they can be unit-tested without an Electron runtime. main.ts wires
// the real ChildProcess / autoUpdater into these.
// ---------------------------------------------------------------------------

// How long we wait for a graceful SIGTERM exit before escalating to SIGKILL.
export const STOP_TIMEOUT_MS = 5000;

// Minimal surface of a child process we depend on, so tests can supply a fake.
// Deliberately narrower than node's ChildProcess (whose `once` returns `this`)
// so a lightweight fake can satisfy it.
export interface StoppableProcess {
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: "exit", listener: (...args: unknown[]) => void): unknown;
}

// Stop a child process gracefully: send SIGTERM, then escalate to SIGKILL if it
// hasn't exited within timeoutMs. Resolves once the process is gone (or the
// kill fallback has fired). Never rejects. This is the single shared shutdown
// path used by BOTH the normal quit and the auto-update install, so the
// SIGTERM→SIGKILL fallback behaves identically on either path.
export function stopProcess(
  proc: StoppableProcess,
  timeoutMs: number = STOP_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve) => {
    const killTimer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      resolve();
    }, timeoutMs);
    proc.once("exit", () => {
      clearTimeout(killTimer);
      resolve();
    });
    proc.kill("SIGTERM");
  });
}

// Install a downloaded auto-update without corrupting the embedded PGlite DB.
// The server child holds the database open, so it MUST be fully stopped before
// the installer swaps app files. We therefore await stopServer() and only then
// call quitAndInstall(). quitAndInstall is wrapped in finally so a stop error
// can never permanently wedge an update — but on the happy path the stop always
// completes first, which is the property that protects the DB.
export async function installDownloadedUpdate(deps: {
  stopServer: () => Promise<void>;
  quitAndInstall: () => void;
  setAutoInstallOnAppQuit: (value: boolean) => void;
  markQuitting: () => void;
}): Promise<void> {
  // Ensure the update still applies if the process exits for any other reason
  // before quitAndInstall lands, and mark that we are intentionally tearing the
  // server down (so its unexpected-exit logging stays quiet).
  deps.setAutoInstallOnAppQuit(true);
  deps.markQuitting();
  try {
    await deps.stopServer();
  } finally {
    deps.quitAndInstall();
  }
}

export async function stopDesktopWork(deps: {
  stopImports: () => Promise<void>;
  stopServer: () => Promise<void>;
  stopLlama: () => Promise<void>;
}): Promise<void> {
  await deps.stopImports();
  await deps.stopServer();
  await deps.stopLlama();
}
