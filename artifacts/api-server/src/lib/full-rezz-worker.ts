import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);
const MAX_WORKER_MS = 30 * 60 * 1000;
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type WorkerOperation =
  | "companion_reference_import"
  | "companion_reference_preview"
  | "companion_host_speech"
  | "companion_export"
  | "companion_import"
  | "companion_history_preview"
  | "companion_history_list"
  | "companion_history_context"
  | "companion_history_rollback"
  | "companion_history_export"
  | "companion_review"
  | "companion_rollback_import"
  | "health";

export type FullRezzJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface FullRezzJob {
  id: string;
  kind: "speech" | "movie_export";
  status: FullRezzJobStatus;
  createdAt: string;
  updatedAt: string;
  engramId: number;
  messageId?: number;
  turnId?: string;
  generationIds?: string[];
  audioUrl?: string;
  videoUrl?: string;
  auditUrl?: string;
  progress?: { completedFrames: number; totalFrames: number; percent: number };
  exportMetadata?: Record<string, unknown>;
  performance?: Record<string, unknown>;
  error?: string;
}

interface StoredJob extends FullRezzJob {
  workspaceHash: string;
  operation: WorkerOperation;
  args: Record<string, unknown>;
  audioRelativePath?: string;
  videoRelativePath?: string;
  auditRelativePath?: string;
  result?: Record<string, unknown>;
}

interface RuntimeConfig {
  moduleRoot: string;
  pythonPath: string;
  workspaceRoot: string;
}

const activeChildren = new Map<string, ChildProcess>();
const activeJobIds = new Set<string>();
const activeJobs = new Map<string, StoredJob>();
const ownerQueues = new Map<string, Promise<void>>();
let verifiedRuntimeKey: string | null = null;

function runtimeConfig(): RuntimeConfig | null {
  const moduleRoot = process.env.FULL_REZZ_ROOT;
  const pythonPath = process.env.FULL_REZZ_PYTHON;
  const workspaceRoot = process.env.FULL_REZZ_WORKSPACE_DIR;
  if (!moduleRoot || !pythonPath || !workspaceRoot) return null;
  const worker = path.join(moduleRoot, "voice_studio", "worker.py");
  const requiredRuntimeFiles = [
    path.join(moduleRoot, "models", "manifest.json"),
    path.join(moduleRoot, "fonts", "manifest.json"),
    path.join(moduleRoot, "vendor", "espeak-ng", "manifest.json"),
    path.join(moduleRoot, "vendor", "llama-cpp", "manifest.json"),
  ];
  if (
    !existsSync(worker) ||
    !existsSync(pythonPath) ||
    !existsSync(path.join(moduleRoot, "full_rezz_bridge", "pack.py")) ||
    requiredRuntimeFiles.some((file) => !existsSync(file))
  ) {
    return null;
  }
  return {
    moduleRoot: path.resolve(moduleRoot),
    pythonPath: path.resolve(pythonPath),
    workspaceRoot: path.resolve(workspaceRoot),
  };
}

export function getFullRezzRuntimeStatus() {
  const config = runtimeConfig();
  return config
    ? {
        available: true as const,
        runtimeVersion: "3.0.0" as const,
        integrityVerified: verifiedRuntimeKey === `${config.moduleRoot}:${config.pythonPath}`,
      }
    : {
        available: false as const,
        runtimeVersion: "3.0.0" as const,
        reason:
          "The FULL_REZZ 3.0 local Python runtime and model bundle are not staged with this desktop build.",
      };
}

export function fullRezzWorkspaceForOwner(ownerId: string): string {
  const config = runtimeConfig();
  if (!config) {
    throw new Error(
      "The FULL_REZZ 3.0 local runtime is unavailable in this build. No system Python or remote voice fallback is used.",
    );
  }
  const ownerKey = createHash("sha256").update(ownerId).digest("hex");
  return path.join(config.workspaceRoot, "owners", ownerKey);
}

async function verifyRuntimeIntegrity(ownerId: string): Promise<void> {
  const config = runtimeConfig();
  if (!config) {
    throw new Error(
      "The FULL_REZZ 3.0 local runtime is unavailable in this build. No system Python or remote voice fallback is used.",
    );
  }
  const key = `${config.moduleRoot}:${config.pythonPath}`;
  if (verifiedRuntimeKey === key) return;
  const health = await runWorker(ownerId, "health", {});
  if (health.passed !== true) {
    throw new Error("FULL_REZZ runtime/model integrity check failed; no audio was generated.");
  }
  verifiedRuntimeKey = key;
}

function envForWorker(config: RuntimeConfig, workspace: string): NodeJS.ProcessEnv {
  const runtimeDir = path.dirname(config.pythonPath);
  const pathParts = [runtimeDir, process.env.PATH].filter(Boolean);
  const env: NodeJS.ProcessEnv = {
    PATH: pathParts.join(path.delimiter),
    PYTHONPATH: config.moduleRoot,
    PYTHONNOUSERSITE: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
    HF_HUB_DISABLE_TELEMETRY: "1",
    NO_PROXY: "*",
    no_proxy: "*",
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    TMPDIR: process.env.TMPDIR,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    SYSTEMROOT: process.env.SYSTEMROOT,
    WINDIR: process.env.WINDIR,
    LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH,
    HF_HOME: path.join(workspace, "cache", "hf"),
  };
  return env;
}

async function runWorker(
  ownerId: string,
  operation: WorkerOperation,
  args: Record<string, unknown>,
  onChild?: (child: ChildProcess) => void,
  onProgress?: (value: { completedFrames: number; totalFrames: number }) => void,
): Promise<Record<string, unknown>> {
  const config = runtimeConfig();
  if (!config) {
    throw new Error(
      "The FULL_REZZ 3.0 local runtime is unavailable in this build. No system Python or remote voice fallback is used.",
    );
  }
  const workspace = fullRezzWorkspaceForOwner(ownerId);
  mkdirSync(workspace, { recursive: true });
  const taskDir = await mkdtemp(path.join(os.tmpdir(), "engram-full-rezz-"));
  const taskPath = path.join(taskDir, "task.json");
  const resultPath = path.join(taskDir, "result.json");
  await writeFile(
    taskPath,
    JSON.stringify({
      workspace,
      operation,
      args,
      result_path: resultPath,
    }),
    { mode: 0o600 },
  );

  try {
    const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const bootstrap =
        "import runpy,sys;sys.path.insert(0,sys.argv[1]);task=sys.argv[2];sys.argv=['voice_studio.worker',task];runpy.run_module('voice_studio.worker',run_name='__main__')";
      const child = spawn(config.pythonPath, ["-B", "-c", bootstrap, config.moduleRoot, taskPath], {
        cwd: config.moduleRoot,
        env: envForWorker(config, workspace),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        detached: process.platform !== "win32",
      });
      onChild?.(child);
      let output = "";
      let stdoutLineBuffer = "";
      const append = (chunk: Buffer, isStdout = false) => {
        output = `${output}${chunk.toString("utf8")}`.slice(-12_000);
        if (!isStdout || !onProgress) return;
        stdoutLineBuffer += chunk.toString("utf8");
        const lines = stdoutLineBuffer.split(/\r?\n/);
        stdoutLineBuffer = lines.pop() ?? "";
        for (const line of lines) {
          try {
            const progress = JSON.parse(line) as {
              exported_frame?: unknown;
              total_frames?: unknown;
            };
            if (
              Number.isSafeInteger(progress.exported_frame) &&
              Number.isSafeInteger(progress.total_frames) &&
              Number(progress.total_frames) > 0
            ) {
              onProgress({
                completedFrames: Number(progress.exported_frame),
                totalFrames: Number(progress.total_frames),
              });
            }
          } catch {
            // Worker diagnostics are not progress records.
          }
        }
      };
      child.stdout?.on("data", (chunk: Buffer) => append(chunk, true));
      child.stderr?.on("data", (chunk: Buffer) => append(chunk));
      const timeout = setTimeout(() => {
        void killWorkerTree(child);
        reject(new Error("FULL_REZZ local worker exceeded its 30-minute job limit."));
      }, MAX_WORKER_MS);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(new Error(`FULL_REZZ local worker could not start: ${error.message}`));
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(
            new Error(
              `FULL_REZZ local worker exited with code ${String(code)}${signal ? ` (${signal})` : ""}.${output ? ` ${output.slice(-1200)}` : ""}`,
            ),
          );
          return;
        }
        void readFile(resultPath, "utf8")
          .then((contents) => {
            const envelope = JSON.parse(contents) as {
              ok?: boolean;
              result?: Record<string, unknown>;
              error?: string;
            };
            if (envelope.ok !== true || !envelope.result) {
              reject(
                new Error(
                  typeof envelope.error === "string"
                    ? envelope.error.slice(0, 1200)
                    : "FULL_REZZ worker returned no successful result.",
                ),
              );
              return;
            }
            resolve(envelope.result);
          })
          .catch((error: unknown) => {
            reject(
              new Error(
                `FULL_REZZ worker produced no readable result.${output ? ` ${output.slice(-1200)}` : ""}`,
              ),
            );
          });
      });
    });
    return result;
  } finally {
    await rm(taskDir, { recursive: true, force: true });
  }
}

async function killWorkerTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        timeout: 10_000,
      });
    } catch {
      child.kill();
    }
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

function jobPath(workspace: string, id: string): string {
  if (!JOB_ID_PATTERN.test(id)) throw new Error("Invalid FULL_REZZ job ID.");
  const dir = path.join(workspace, "jobs");
  return path.join(dir, `${id}.json`);
}

function jobWasCancelled(jobId: string): boolean {
  return activeJobs.get(jobId)?.status === "cancelled";
}

async function saveJob(workspace: string, job: StoredJob): Promise<void> {
  const destination = jobPath(workspace, job.id);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(job), { mode: 0o600 });
  await rename(temporary, destination);
}

function audioPathFromResult(
  workspace: string,
  result: Record<string, unknown>,
): string | undefined {
  const audioPath = result.audio_path;
  if (typeof audioPath !== "string") return undefined;
  const absolute = path.resolve(audioPath);
  const relative = path.relative(path.resolve(workspace), absolute);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    throw new Error("FULL_REZZ returned an audio path outside the private workspace.");
  }
  if (!existsSync(absolute)) throw new Error("FULL_REZZ returned audio that is not present.");
  return relative;
}

export async function importFullRezzReferencePack(
  ownerId: string,
  archivePath: string,
): Promise<Record<string, unknown>> {
  return runWorker(ownerId, "companion_reference_import", { path: archivePath });
}

export async function previewFullRezzReferencePack(
  ownerId: string,
  archivePath: string,
): Promise<Record<string, unknown>> {
  return runWorker(ownerId, "companion_reference_preview", { path: archivePath });
}

export async function rollbackFullRezzImport(
  ownerId: string,
  importId: string,
): Promise<void> {
  await runWorker(ownerId, "companion_rollback_import", { import_id: importId });
}

export async function previewFullRezzHistory(
  ownerId: string,
  profileId: string,
  filePath: string,
  filename: string,
  mapping: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return runWorker(ownerId, "companion_history_preview", {
    pid: profileId,
    path: filePath,
    filename,
    mapping,
  });
}

export async function importFullRezzHistory(
  ownerId: string,
  profileId: string,
  filePath: string,
  mapping: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return runWorker(ownerId, "companion_import", {
    pid: profileId,
    path: filePath,
    mapping,
  });
}

export async function listFullRezzHistory(
  ownerId: string,
  profileId: string,
  limit = 50,
  offset = 0,
): Promise<Record<string, unknown>> {
  return runWorker(ownerId, "companion_history_list", {
    pid: profileId,
    limit,
    offset,
  });
}

export async function retrieveFullRezzHistoryContext(
  ownerId: string,
  profileId: string,
  query: string,
  receiptId: string,
): Promise<Record<string, unknown> | null> {
  if (!runtimeConfig()) return null;
  return runWorker(ownerId, "companion_history_context", {
    pid: profileId,
    query,
    receipt_id: receiptId,
    recent: 8,
    selected: 8,
    max_chars: 6500,
  });
}

export async function exportFullRezzHistory(
  ownerId: string,
  profileId: string,
): Promise<string> {
  const workspace = fullRezzWorkspaceForOwner(ownerId);
  const destination = path.join(
    workspace,
    "exports",
    `history-${randomUUID()}.json`,
  );
  await mkdir(path.dirname(destination), { recursive: true });
  const result = await runWorker(ownerId, "companion_history_export", {
    pid: profileId,
    path: destination,
  });
  if (result.path !== destination || !existsSync(destination)) {
    throw new Error("FULL_REZZ history export did not produce its requested file.");
  }
  return destination;
}

export async function rollbackFullRezzHistoryImport(
  ownerId: string,
  profileId: string,
  importId: string,
): Promise<Record<string, unknown>> {
  return runWorker(ownerId, "companion_history_rollback", {
    pid: profileId,
    import_id: importId,
  });
}

export async function submitFullRezzSpeechJob(input: {
  ownerId: string;
  engramId: number;
  conversationId: number;
  messageId: number;
  profileId: string;
  text: string;
  settings: Record<string, unknown>;
}): Promise<FullRezzJob> {
  const workspace = fullRezzWorkspaceForOwner(input.ownerId);
  const ownerKey = createHash("sha256").update(input.ownerId).digest("hex");
  const id = randomUUID();
  const now = new Date().toISOString();
  const turnId = `host_${input.conversationId}_${input.messageId}`;
  const stored: StoredJob = {
    id,
    kind: "speech",
    status: "queued",
    createdAt: now,
    updatedAt: now,
    engramId: input.engramId,
    messageId: input.messageId,
    turnId,
    workspaceHash: ownerKey,
    operation: "companion_host_speech",
    args: {
      pid: input.profileId,
      text: input.text,
      turn_id: turnId,
      conversation_id: input.conversationId,
      message_id: input.messageId,
      settings: input.settings,
    },
  };
  await saveJob(workspace, stored);
  activeJobIds.add(id);
  activeJobs.set(id, stored);

  const previous = ownerQueues.get(ownerKey) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(async () => {
      if (jobWasCancelled(id)) return;
      stored.status = "running";
      stored.updatedAt = new Date().toISOString();
      await saveJob(workspace, stored);
      try {
        await verifyRuntimeIntegrity(input.ownerId);
        const result = await runWorker(input.ownerId, stored.operation, stored.args, (child) => {
          activeChildren.set(id, child);
        });
        if (jobWasCancelled(id)) return;
        const audioRelativePath = audioPathFromResult(workspace, result);
        if (!audioRelativePath) throw new Error("FULL_REZZ completed without a real WAV file.");
        const generationIds = Array.isArray(result.generation_ids)
          ? result.generation_ids.filter((value): value is string => typeof value === "string")
          : [];
        const performance = typeof result.performance === "object" && result.performance !== null
          ? (result.performance as Record<string, unknown>)
          : undefined;
        stored.status = "succeeded";
        stored.updatedAt = new Date().toISOString();
        stored.audioRelativePath = audioRelativePath;
        stored.generationIds = generationIds;
        stored.audioUrl = `/api/full-rezz/jobs/${id}/audio`;
        stored.performance = performance;
        stored.result = {
          spoken_text: result.spoken_text,
          full_reply_spoken: result.full_reply_spoken,
          generation_ids: generationIds,
          performance,
        };
      } catch (error) {
        if (!jobWasCancelled(id)) {
          stored.status = "failed";
          stored.updatedAt = new Date().toISOString();
          stored.error = error instanceof Error ? error.message.slice(0, 1200) : "FULL_REZZ speech failed.";
        }
      } finally {
        activeChildren.delete(id);
        await saveJob(workspace, stored);
      }
    });
  ownerQueues.set(ownerKey, run);
  void run.finally(() => {
    activeChildren.delete(id);
    activeJobIds.delete(id);
    activeJobs.delete(id);
    if (ownerQueues.get(ownerKey) === run) ownerQueues.delete(ownerKey);
  });
  return publicJob(stored);
}

export async function submitFullRezzMovieExportJob(input: {
  ownerId: string;
  engramId: number;
  conversationId: number;
  messageId: number;
  profileId: string;
  mode: "2d" | "3d";
  viewId: string;
  action: string;
  fps: 60 | 120 | 240;
  width: number;
  height: number;
  clip: number | null;
}): Promise<FullRezzJob> {
  if (![60, 120, 240].includes(input.fps)) {
    throw new Error("Choose 60, 120 or 240 fps.");
  }
  if (
    !Number.isSafeInteger(input.width) ||
    !Number.isSafeInteger(input.height) ||
    input.width < 64 ||
    input.height < 64 ||
    input.width > 1920 ||
    input.height > 1080 ||
    input.width % 2 !== 0 ||
    input.height % 2 !== 0
  ) {
    throw new Error("Choose even movie dimensions within 64–1920 by 64–1080.");
  }
  const workspace = fullRezzWorkspaceForOwner(input.ownerId);
  const ownerKey = createHash("sha256").update(input.ownerId).digest("hex");
  const id = randomUUID();
  const turnId = `host_${input.conversationId}_${input.messageId}`;
  const exportPath = path.join(workspace, "exports", `${id}.webm`);
  const now = new Date().toISOString();
  const stored: StoredJob = {
    id,
    kind: "movie_export",
    status: "queued",
    createdAt: now,
    updatedAt: now,
    engramId: input.engramId,
    messageId: input.messageId,
    turnId,
    workspaceHash: ownerKey,
    operation: "companion_export",
    args: {
      pid: input.profileId,
      mode: input.mode,
      view_id: input.viewId,
      clip: input.mode === "3d" ? input.clip : null,
      action: input.action,
      fps: input.fps,
      path: exportPath,
      turn_id: turnId,
      width: input.width,
      height: input.height,
    },
    progress: { completedFrames: 0, totalFrames: 12 * input.fps, percent: 0 },
  };
  await saveJob(workspace, stored);
  activeJobIds.add(id);
  activeJobs.set(id, stored);

  const previous = ownerQueues.get(ownerKey) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(async () => {
      if (jobWasCancelled(id)) return;
      stored.status = "running";
      stored.updatedAt = new Date().toISOString();
      await saveJob(workspace, stored);
      try {
        const result = await runWorker(
          input.ownerId,
          stored.operation,
          stored.args,
          (child) => activeChildren.set(id, child),
          (progress) => {
            stored.progress = {
              ...progress,
              percent: Math.min(
                100,
                Math.floor((progress.completedFrames / progress.totalFrames) * 100),
              ),
            };
            stored.updatedAt = new Date().toISOString();
            void saveJob(workspace, stored).catch(() => undefined);
          },
        );
        if (jobWasCancelled(id)) return;
        const expectedVideo = path.resolve(exportPath);
        const expectedAudit = path.resolve(exportPath.replace(/\.webm$/i, ".audit.json"));
        const videoRelative = path.relative(path.resolve(workspace), expectedVideo);
        const auditRelative = path.relative(path.resolve(workspace), expectedAudit);
        if (
          !videoRelative ||
          videoRelative.startsWith(`..${path.sep}`) ||
          path.isAbsolute(videoRelative) ||
          !auditRelative ||
          auditRelative.startsWith(`..${path.sep}`) ||
          path.isAbsolute(auditRelative) ||
          !existsSync(expectedVideo) ||
          !existsSync(expectedAudit)
        ) {
          throw new Error("FULL_REZZ movie export did not produce contained video and audit files.");
        }
        if (
          result.path !== expectedVideo ||
          result.fps !== input.fps ||
          !Number.isSafeInteger(result.frames) ||
          result.all_video_frames_decoded_and_timestamps_checked !== true ||
          typeof result.sha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(result.sha256)
        ) {
          throw new Error("FULL_REZZ movie export returned an incomplete or unaudited result.");
        }
        const {
          path: _path,
          profile_id: _profileId,
          ...metadata
        } = result;
        stored.status = "succeeded";
        stored.updatedAt = new Date().toISOString();
        stored.progress = {
          completedFrames: Number(result.frames),
          totalFrames: Number(result.frames),
          percent: 100,
        };
        stored.videoRelativePath = videoRelative;
        stored.auditRelativePath = auditRelative;
        stored.videoUrl = `/api/full-rezz/jobs/${id}/video`;
        stored.auditUrl = `/api/full-rezz/jobs/${id}/audit`;
        stored.exportMetadata = metadata;
      } catch (error) {
        if (!jobWasCancelled(id)) {
          stored.status = "failed";
          stored.updatedAt = new Date().toISOString();
          stored.error =
            error instanceof Error
              ? error.message.slice(0, 1200)
              : "FULL_REZZ movie export failed.";
        }
      } finally {
        activeChildren.delete(id);
        await saveJob(workspace, stored);
      }
    });
  ownerQueues.set(ownerKey, run);
  void run.finally(() => {
    activeChildren.delete(id);
    activeJobIds.delete(id);
    activeJobs.delete(id);
    if (ownerQueues.get(ownerKey) === run) ownerQueues.delete(ownerKey);
  });
  return publicJob(stored);
}

function publicJob(job: StoredJob): FullRezzJob {
  const {
    workspaceHash: _workspaceHash,
    operation: _operation,
    args: _args,
    audioRelativePath: _audioPath,
    videoRelativePath: _videoPath,
    auditRelativePath: _auditPath,
    result: _result,
    ...publicValue
  } = job;
  return publicValue;
}

export async function getFullRezzJob(
  ownerId: string,
  id: string,
): Promise<FullRezzJob | null> {
  const workspace = fullRezzWorkspaceForOwner(ownerId);
  const file = jobPath(workspace, id);
  let stored: StoredJob;
  try {
    stored = JSON.parse(await readFile(file, "utf8")) as StoredJob;
  } catch {
    return null;
  }
  const ownerKey = createHash("sha256").update(ownerId).digest("hex");
  if (stored.workspaceHash !== ownerKey) return null;
  stored.kind ??= "speech";
  if (
    (stored.status === "queued" || stored.status === "running") &&
    !activeJobIds.has(stored.id)
  ) {
    stored.status = "failed";
    stored.updatedAt = new Date().toISOString();
    stored.error = "The local worker stopped before this job completed. Start a new FULL_REZZ job to retry.";
    await saveJob(workspace, stored);
  }
  const liveJob = activeJobs.get(stored.id);
  if (liveJob) stored = liveJob;
  return publicJob(stored);
}

export async function getFullRezzAudioPath(
  ownerId: string,
  id: string,
): Promise<string | null> {
  const workspace = fullRezzWorkspaceForOwner(ownerId);
  const file = jobPath(workspace, id);
  let stored: StoredJob;
  try {
    stored = JSON.parse(await readFile(file, "utf8")) as StoredJob;
  } catch {
    return null;
  }
  const ownerKey = createHash("sha256").update(ownerId).digest("hex");
  stored.kind ??= "speech";
  if (
    stored.workspaceHash !== ownerKey ||
    stored.kind !== "speech" ||
    stored.status !== "succeeded" ||
    !stored.audioRelativePath
  ) {
    return null;
  }
  const absolute = path.resolve(workspace, stored.audioRelativePath);
  const relative = path.relative(path.resolve(workspace), absolute);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    return null;
  }
  return existsSync(absolute) ? absolute : null;
}

export async function getFullRezzMoviePath(
  ownerId: string,
  id: string,
  artifact: "video" | "audit",
): Promise<string | null> {
  const workspace = fullRezzWorkspaceForOwner(ownerId);
  const file = jobPath(workspace, id);
  let stored: StoredJob;
  try {
    stored = JSON.parse(await readFile(file, "utf8")) as StoredJob;
  } catch {
    return null;
  }
  const ownerKey = createHash("sha256").update(ownerId).digest("hex");
  if (
    stored.workspaceHash !== ownerKey ||
    stored.kind !== "movie_export" ||
    stored.status !== "succeeded"
  ) {
    return null;
  }
  const relativePath =
    artifact === "video" ? stored.videoRelativePath : stored.auditRelativePath;
  if (!relativePath) return null;
  const absolute = path.resolve(workspace, relativePath);
  const relative = path.relative(path.resolve(workspace), absolute);
  if (
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    return null;
  }
  return existsSync(absolute) ? absolute : null;
}

export async function cancelFullRezzJob(
  ownerId: string,
  id: string,
): Promise<FullRezzJob | null> {
  const workspace = fullRezzWorkspaceForOwner(ownerId);
  const file = jobPath(workspace, id);
  let stored: StoredJob;
  try {
    stored = JSON.parse(readFileSync(file, "utf8")) as StoredJob;
  } catch {
    return null;
  }
  const ownerKey = createHash("sha256").update(ownerId).digest("hex");
  if (stored.workspaceHash !== ownerKey) return null;
  stored.kind ??= "speech";
  if (stored.status === "queued" || stored.status === "running") {
    const liveJob = activeJobs.get(id) ?? stored;
    liveJob.status = "cancelled";
    liveJob.updatedAt = new Date().toISOString();
    liveJob.error = "FULL_REZZ job cancelled by the user.";
    activeJobs.set(id, liveJob);
    stored = liveJob;
    await saveJob(workspace, liveJob);
    const child = activeChildren.get(id);
    if (child) await killWorkerTree(child);
  }
  return publicJob(stored);
}

export async function reviewFullRezzGeneration(
  ownerId: string,
  generationId: string,
  ratings: Record<string, string>,
  notes: string,
): Promise<Record<string, unknown>> {
  return runWorker(ownerId, "companion_review", {
    generation_id: generationId,
    ratings,
    notes,
  });
}
