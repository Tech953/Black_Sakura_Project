import path from "node:path";
import type { CustomGgufMetadata } from "./custom-gguf";
import type { DesktopLlmMode } from "./desktop-bridge";

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
  return candidate as CustomGgufMetadata;
}