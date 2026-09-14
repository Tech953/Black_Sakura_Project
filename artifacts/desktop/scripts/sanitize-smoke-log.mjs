import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const filePath = process.argv[2];
const maxBytes = 256 * 1024;
if (!filePath || !existsSync(filePath)) process.exit(0);

let output = readFileSync(filePath, "utf8");
const replacements = [
  [process.env.GITHUB_WORKSPACE, "<workspace>"],
  [process.cwd(), "<workspace>"],
  [os.tmpdir(), "<tmp>"],
  [os.homedir(), "<home>"],
  [process.env.ENGRAM_PACKAGED_GGUF_FIXTURE, "<gguf-fixture>"],
].filter(([source]) => source);
for (const [source, replacement] of replacements) {
  output = output.split(source).join(replacement);
}
const secrets = Object.entries(process.env)
  .filter(
    ([name, value]) =>
      Boolean(value) &&
      /(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|CREDENTIAL)/i.test(name),
  )
  .map(([, value]) => value)
  .filter((value) => value.length >= 4);
for (const secret of secrets) output = output.split(secret).join("[redacted]");
output = output
  .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
  .replace(
    /\b(api[_-]?key|token|secret|password|authorization)(\s*[:=]\s*)[^\s,;]+/gi,
    "$1$2[redacted]",
  );

const bytes = Buffer.from(output, "utf8");
if (bytes.length > maxBytes) {
  const marker = Buffer.from(
    "\n[diagnostic output truncated; showing the most recent bytes]\n",
    "utf8",
  );
  output = Buffer.concat([marker, bytes.subarray(-(maxBytes - marker.length))])
    .subarray(-maxBytes)
    .toString("utf8");
}
writeFileSync(filePath, output, { mode: 0o600 });
