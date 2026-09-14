import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export const MAX_SMOKE_DIAGNOSTIC_BYTES = 256 * 1024;

export function sanitizeDiagnosticText(
  value: string,
  replacements: Array<[string, string]> = [],
  secretValues: string[] = [],
): string {
  let safe = value;
  for (const [source, replacement] of replacements) {
    if (source) safe = safe.split(source).join(replacement);
  }
  for (const secret of secretValues) {
    if (secret) safe = safe.split(secret).join("[redacted]");
  }
  return safe
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(
      /\b(api[_-]?key|token|secret|password|authorization)(\s*[:=]\s*)[^\s,;]+/gi,
      "$1$2[redacted]",
    );
}

export function appendBoundedDiagnostic(
  filePath: string,
  value: string,
  maxBytes = MAX_SMOKE_DIAGNOSTIC_BYTES,
): void {
  const incoming = Buffer.from(value, "utf8");
  if (incoming.length === 0) return;
  mkdirSync(path.dirname(filePath), { recursive: true });

  if (!existsSync(filePath)) {
    writeFileSync(filePath, incoming, { mode: 0o600 });
    return;
  }

  const currentBytes = statSync(filePath).size;
  if (currentBytes + incoming.length <= maxBytes) {
    appendFileSync(filePath, incoming);
    return;
  }

  const marker = Buffer.from(
    "\n[diagnostic output truncated; showing the most recent bytes]\n",
    "utf8",
  );
  const existing = readFileSync(filePath);
  const payloadCapacity = Math.max(0, maxBytes - marker.length);
  const output =
    incoming.length >= payloadCapacity
      ? Buffer.concat([marker, incoming.subarray(-payloadCapacity)]).subarray(
          -maxBytes,
        )
      : Buffer.concat([
          marker,
          existing.subarray(
            Math.max(0, existing.length - payloadCapacity + incoming.length),
          ),
          incoming,
        ]).subarray(-maxBytes);
  writeFileSync(filePath, output, { mode: 0o600 });
}
