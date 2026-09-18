export type LlamaRuntimeFailureCode =
  | "missing-server"
  | "unsupported-architecture"
  | "missing-linux-dependencies"
  | "ldd-unavailable"
  | "ldd-failed"
  | "missing-macos-dylibs"
  | "otool-unavailable"
  | "otool-failed"
  | "missing-windows-dlls"
  | "runtime-architecture-mismatch"
  | "runtime-architecture-unreadable"
  | "runtime-not-executable"
  | "runtime-execution-failed";

export type LlamaRuntimeRepairAction =
  | "install-linux-runtime"
  | "restage-complete-runtime"
  | "restore-execute-permission"
  | "rebuild-target-runtime"
  | "build-target-runtime"
  | "run-on-supported-host"
  | "restage-runtime";

export type LlamaRuntimeFailureReason =
  | "permission-denied"
  | "exec-format-error";

export const LLAMA_RUNTIME_FAILURE_CODES: readonly LlamaRuntimeFailureCode[];
export function llamaRuntimeRepairAction(
  code: LlamaRuntimeFailureCode,
  reason?: LlamaRuntimeFailureReason,
): LlamaRuntimeRepairAction;
export function llamaRuntimeFailureMessage(input: {
  code: LlamaRuntimeFailureCode;
  executablePath?: string;
  platform?: string;
  architecture?: string;
  missingLibraries?: string[];
  detectedArchitectures?: string[];
  packageNames?: string[];
  reason?: LlamaRuntimeFailureReason;
  details?: string;
}): string;
export function classifyLlamaRuntimeError(input: {
  errorCode?: string;
  message?: string;
  stderr?: string;
  platform?: string;
}): {
  code: LlamaRuntimeFailureCode;
  reason?: LlamaRuntimeFailureReason;
  missingLibraries?: string[];
  repairAction: LlamaRuntimeRepairAction;
};
export function inspectLlamaRuntimeArchitecture(executablePath: string): {
  ok: true;
  architectures: string[];
} | {
  ok: false;
  details: string;
};
export function checkLlamaRuntimeArchitecture(input: {
  executablePath: string;
  platform: string;
  architecture: string;
}): {
  ok: true;
  architectures: string[];
} | {
  ok: false;
  code: "runtime-architecture-mismatch" | "runtime-architecture-unreadable";
  detectedArchitectures?: string[];
  repairAction: LlamaRuntimeRepairAction;
  message: string;
};