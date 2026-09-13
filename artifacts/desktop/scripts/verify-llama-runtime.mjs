import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkLlamaRuntime } from "./llama-runtime-check.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..", "..", "..");
const platform = process.env.LLAMA_TARGET || process.platform;
const architecture = process.env.LLAMA_ARCH || process.arch;
const runtimeRoot =
  platform === "win32"
    ? path.join(repoRoot, ".llama", "llama-b10242-win-x64")
    : path.join(repoRoot, ".llama", "llama-b10242");
const executablePath = path.join(
  runtimeRoot,
  platform === "win32" ? "llama-server.exe" : "llama-server",
);

if (!existsSync(executablePath)) {
  throw new Error(
    `Pinned llama.cpp runtime is missing for ${platform}-${architecture}: ${executablePath}`,
  );
}

const result = checkLlamaRuntime({
  executablePath,
  platform,
  architecture,
});
if (!result.ok) throw new Error(result.message);

console.log(
  `[desktop] verified llama.cpp runtime for ${platform}-${architecture} (${result.code})`,
);