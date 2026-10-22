import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";

// SmolLM2 is small enough for release smoke CI while still exercising the
// pinned llama.cpp runtime with a real model, unlike a header-only placeholder.
// Keep the URL and digest together so an upstream replacement cannot silently
// change the test input.
export const SMOKE_GGUF_URL =
  "https://huggingface.co/bartowski/SmolLM2-135M-Instruct-GGUF/resolve/" +
  "main/SmolLM2-135M-Instruct-Q4_K_M.gguf?download=true";
export const SMOKE_GGUF_SHA256 =
  "2e8040ceae7815abe0dcb3540b9995eaa1fa0d2ca9e797d0a635ae4433c68c2d";

async function inspectFixture(file) {
  const hash = createHash("sha256");
  let header = Buffer.alloc(0);
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
    if (header.length < 4) {
      header = Buffer.concat([header, chunk.subarray(0, 4 - header.length)]);
    }
  }
  return { header: header.toString("ascii"), sha256: hash.digest("hex") };
}

async function isVerifiedFixture(file, expectedSha256) {
  try {
    const inspected = await inspectFixture(file);
    return inspected.header === "GGUF" && inspected.sha256 === expectedSha256;
  } catch {
    return false;
  }
}

export async function downloadSmokeGguf(
  output,
  {
    url = SMOKE_GGUF_URL,
    expectedSha256 = SMOKE_GGUF_SHA256,
    fetchImpl = globalThis.fetch,
    renameFile = rename,
  } = {},
) {
  if (!output || !path.isAbsolute(output)) {
    throw new Error(
      "Usage: node download-smoke-gguf.mjs /absolute/output.gguf",
    );
  }
  const temporary = `${output}.${process.pid}.partial`;

  if (await isVerifiedFixture(output, expectedSha256)) {
    console.log(`Using cached compatible GGUF smoke fixture at ${output}`);
    return { status: "cached", output };
  }

  // Cache entries are immutable in GitHub Actions. Remove an invalid restored file
  // locally so this run cannot use it, then replace it atomically after verification.
  await rm(output, { force: true, recursive: true });
  await rm(temporary, { force: true, recursive: true });

  try {
    const response = await fetchImpl(url, { redirect: "follow" });
    if (!response.ok || !response.body) {
      throw new Error(`Could not download GGUF smoke fixture: HTTP ${response.status}`);
    }
    await mkdir(path.dirname(output), { recursive: true });
    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
    );
    const inspected = await inspectFixture(temporary);
    if (inspected.sha256 !== expectedSha256) {
      throw new Error(
        `GGUF smoke fixture checksum mismatch: ${inspected.sha256} (expected ${expectedSha256})`,
      );
    }
    if (inspected.header !== "GGUF") {
      throw new Error("Downloaded smoke fixture is not a GGUF file");
    }
    if (!(await isVerifiedFixture(temporary, expectedSha256))) {
      throw new Error("GGUF smoke fixture changed while being staged");
    }
    await renameFile(temporary, output);
  } catch (error) {
    await rm(temporary, { force: true, recursive: true });
    throw error;
  }

  const { size } = await stat(output);
  console.log(`Staged compatible GGUF smoke fixture (${size} bytes) at ${output}`);
  return { status: "downloaded", output, size };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await downloadSmokeGguf(process.argv[2]);
}
