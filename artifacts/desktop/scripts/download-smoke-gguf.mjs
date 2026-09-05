import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const output = process.argv[2];
if (!output || !path.isAbsolute(output)) {
  throw new Error("Usage: node download-smoke-gguf.mjs /absolute/output.gguf");
}

// SmolLM2 is small enough for release smoke CI while still exercising the
// pinned llama.cpp runtime with a real model, unlike a header-only placeholder.
// Keep the URL and digest together so an upstream replacement cannot silently
// change the test input.
const url =
  "https://huggingface.co/bartowski/SmolLM2-135M-Instruct-GGUF/resolve/" +
  "main/SmolLM2-135M-Instruct-Q4_K_M.gguf?download=true";
const expectedSha256 =
  "2e8040ceae7815abe0dcb3540b9995eaa1fa0d2ca9e797d0a635ae4433c68c2d";

const response = await fetch(url, { redirect: "follow" });
if (!response.ok) {
  throw new Error(`Could not download GGUF smoke fixture: HTTP ${response.status}`);
}
const bytes = Buffer.from(await response.arrayBuffer());
const actualSha256 = createHash("sha256").update(bytes).digest("hex");
if (actualSha256 !== expectedSha256) {
  throw new Error(
    `GGUF smoke fixture checksum mismatch: ${actualSha256} (expected ${expectedSha256})`,
  );
}
if (bytes.subarray(0, 4).toString("ascii") !== "GGUF") {
  throw new Error("Downloaded smoke fixture is not a GGUF file");
}

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, bytes, { mode: 0o600 });
const written = await readFile(output);
if (
  written.length !== bytes.length ||
  createHash("sha256").update(written).digest("hex") !== expectedSha256
) {
  throw new Error("GGUF smoke fixture changed while being staged");
}
console.log(`Staged compatible GGUF smoke fixture (${bytes.length} bytes) at ${output}`);