import path from "node:path";
import type { CustomGgufMetadata } from "./custom-gguf";
import type { DesktopLlmMode } from "./desktop-bridge";
import {
  classifyLlamaRuntimeError,
  LLAMA_RUNTIME_FAILURE_CODES,
  llamaRuntimeFailureMessage,
  llamaRuntimeRepairAction,
} from "../scripts/llama-runtime-diagnosis.mjs";
import type {
  LlamaRuntimeFailureCode,
  LlamaRuntimeFailureReason,
  LlamaRuntimeRepairAction,
} from "../scripts/llama-runtime-diagnosis.mjs";

export type LocalModelFailureCode =
  | LlamaRuntimeFailureCode
  | "spawn-failed"
  | "exited-before-ready"
  | "health-timeout"
  | "unknown";

export interface LocalModelFailure {
  code: LocalModelFailureCode;
  platform: string;
  message: string;
  missingLibraries?: string[];
  reason?: LlamaRuntimeFailureReason;
  repairAction: LlamaRuntimeRepairAction;
  automaticFixAvailable: boolean;
}

const LOCAL_MODEL_FAILURE_CODES: readonly LocalModelFailureCode[] = [
  ...LLAMA_RUNTIME_FAILURE_CODES,
  "spawn-failed",
  "exited-before-ready",
  "health-timeout",
  "unknown",
];

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function missingLibrariesFromText(text: string, platform: string): string[] {
  if (platform === "linux") {
    return uniqueStrings(
      [
        ...text.matchAll(
          /(?:error while loading shared libraries:\s*)?([A-Za-z0-9._+-]+\.so(?:\.\d+)?)\b/gi,
        ),
      ].map((match) => match[1]!),
    );
  }
  if (platform === "win32") {
    return uniqueStrings(
      [...text.matchAll(/\b([A-Za-z0-9._-]+\.dll)\b/gi)].map(
        (match) => match[1]!,
      ),
    );
  }
  return [];
}

export function normalizeLocalModelFailure(
  value: unknown,
  fallbackPlatform = process.platform,
): LocalModelFailure | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<LocalModelFailure> & {
    missing?: unknown;
  };
  if (
    typeof candidate.message !== "string" ||
    candidate.message.trim().length === 0 ||
    !LOCAL_MODEL_FAILURE_CODES.includes(candidate.code as LocalModelFailureCode)
  ) {
    return undefined;
  }
  const missingLibraries = Array.isArray(candidate.missingLibraries)
    ? candidate.missingLibraries.filter(
        (name): name is string =>
          typeof name === "string" && name.length <= 256,
      )
    : Array.isArray(candidate.missing)
      ? candidate.missing.filter(
          (name): name is string =>
            typeof name === "string" && name.length <= 256,
        )
      : [];
  const code = candidate.code as LocalModelFailureCode;
  const reason =
    candidate.reason === "permission-denied" ||
    candidate.reason === "exec-format-error"
      ? candidate.reason
      : undefined;
  return {
    code,
    platform:
      typeof candidate.platform === "string"
        ? candidate.platform
        : fallbackPlatform,
    message: candidate.message,
    ...(missingLibraries.length > 0
      ? { missingLibraries: uniqueStrings(missingLibraries) }
      : {}),
    ...(reason ? { reason } : {}),
    repairAction: llamaRuntimeRepairAction(
      code as LlamaRuntimeFailureCode,
      reason,
    ),
    automaticFixAvailable: candidate.automaticFixAvailable === true,
  };
}

export function localModelFailureFromError(
  error: unknown,
  platform = process.platform,
  stderr = "",
  executablePath?: string,
): LocalModelFailure {
  const structured =
    error && typeof error === "object" && "localModelFailure" in error
      ? normalizeLocalModelFailure(
          (error as { localModelFailure?: unknown }).localModelFailure,
          platform,
        )
      : undefined;
  if (structured) return structured;

  const message = error instanceof Error ? error.message : String(error);
  const text = `${message}\n${stderr}`;
  const errorCode =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  const runtimeFailure = classifyLlamaRuntimeError({
    errorCode,
    message,
    stderr,
    platform,
  });
  const missingLibraries =
    runtimeFailure.missingLibraries ?? missingLibrariesFromText(text, platform);
  let code: LocalModelFailureCode = "unknown";
  if (runtimeFailure.code !== "runtime-execution-failed") {
    code = runtimeFailure.code;
  } else if (/missing.*server|server.*missing/i.test(message)) {
    code = "missing-server";
  } else if (/before becoming ready|exited before/i.test(message)) {
    code = "exited-before-ready";
  } else if (/did not become ready|timed out|in time/i.test(message)) {
    code = "health-timeout";
  } else if (errorCode === "ENOENT" || /failed to start/i.test(message)) {
    code = "spawn-failed";
  }

  let userMessage = message;
  if (code === "missing-linux-dependencies") {
    userMessage =
      `The built-in local model is missing Linux runtime libraries: ${missingLibraries.join(", ")}.`;
  } else if (code === "missing-windows-dlls") {
    userMessage =
      `The built-in local model is missing Windows runtime DLLs: ${missingLibraries.join(", ")}.`;
  } else if (
    LLAMA_RUNTIME_FAILURE_CODES.includes(code as LlamaRuntimeFailureCode)
  ) {
    userMessage = llamaRuntimeFailureMessage({
      code: code as LlamaRuntimeFailureCode,
      executablePath,
      platform,
      architecture: process.arch,
      missingLibraries,
      reason: runtimeFailure.reason,
      details: message,
    });
  }
  return {
    code,
    platform,
    message: userMessage,
    ...(missingLibraries.length > 0 ? { missingLibraries } : {}),
    ...(runtimeFailure.reason ? { reason: runtimeFailure.reason } : {}),
    repairAction: LLAMA_RUNTIME_FAILURE_CODES.includes(
      code as LlamaRuntimeFailureCode,
    )
      ? llamaRuntimeRepairAction(
          code as LlamaRuntimeFailureCode,
          runtimeFailure.reason,
        )
      : "restage-runtime",
    automaticFixAvailable: false,
  };
}

export function localModelFailureCopy(failure: LocalModelFailure): {
  title: string;
  guidance: string;
  recovery: string;
} {
  if (failure.repairAction === "install-linux-runtime") {
    return {
      title: "Built-in model needs Linux libraries",
      guidance:
        "Install the missing runtime packages for your distribution, or use a local server or online provider instead.",
      recovery:
        "Automatic repair is not available on Linux. Select Local server or Online, then choose Save & Restart.",
    };
  }
  if (failure.repairAction === "restage-complete-runtime") {
    return {
      title: "Built-in model runtime is incomplete",
      guidance:
        "The installed llama.cpp runtime is missing files. Reinstall or update ENGRAM, or use a local server or online provider instead.",
      recovery:
        "Automatic repair is not available for this installation. Select Local server or Online, then choose Save & Restart.",
    };
  }
  return {
    title: "Built-in model could not start",
    guidance:
      "The built-in local model is unavailable, but the rest of ENGRAM can continue with another provider.",
    recovery:
      "Select Local server or Online, then choose Save & Restart. You can retry Built-in after fixing the runtime.",
  };
}

export function normalizeDesktopMode(value: unknown): DesktopLlmMode {
  if (
    value === "bundled" ||
    value === "custom" ||
    value === "offline" ||
    value === "online"
  ) {
    return value;
  }
  return "bundled";
}

export function normalizeCustomGgufMetadata(
  value: unknown,
): CustomGgufMetadata | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<CustomGgufMetadata>;
  if (
    typeof candidate.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(candidate.sha256) ||
    candidate.path !== `${candidate.sha256}.gguf` ||
    typeof candidate.originalFilename !== "string" ||
    path.basename(candidate.originalFilename) !== candidate.originalFilename ||
    !candidate.originalFilename.toLowerCase().endsWith(".gguf") ||
    !Number.isSafeInteger(candidate.byteSize) ||
    (candidate.byteSize ?? 0) <= 0 ||
    !Number.isInteger(candidate.ggufVersion) ||
    (candidate.ggufVersion ?? 0) < 1 ||
    (candidate.ggufVersion ?? 0) > 3 ||
    typeof candidate.importedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.importedAt))
  ) {
    return undefined;
  }
  if (
    candidate.displayName !== undefined &&
    (typeof candidate.displayName !== "string" ||
      candidate.displayName.trim().length === 0 ||
      candidate.displayName.length > 128)
  ) {
    return undefined;
  }
  if (
    candidate.lastUsedAt !== undefined &&
    (typeof candidate.lastUsedAt !== "string" ||
      !Number.isFinite(Date.parse(candidate.lastUsedAt)))
  ) {
    return undefined;
  }
  return candidate as CustomGgufMetadata;
}