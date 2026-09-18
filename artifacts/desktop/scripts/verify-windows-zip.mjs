import {
  createHash,
} from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  checkLlamaRuntimeArchitecture,
  WINDOWS_RUNTIME_FILES,
} from "./llama-runtime-check.mjs";

const EXPECTED_PLATFORM = "win32";
const EXPECTED_ARCHITECTURE = "x64";
const REQUIRED_RESOURCE_FILES = [
  "server/index.mjs",
  "server/node_modules/@electric-sql/pglite/dist/pglite.wasm",
  "server/node_modules/@electric-sql/pglite/dist/pglite.data",
  "web/index.html",
];

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (!argument.startsWith("--")) continue;
    const name = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}.`);
    }
    values[name] = value;
    index += 1;
  }
  return values;
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function fileExists(filePath) {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function directoryHasFiles(directoryPath) {
  try {
    return readdirSync(directoryPath, { withFileTypes: true }).some(
      (entry) => entry.isFile() || entry.isSymbolicLink(),
    );
  } catch {
    return false;
  }
}

function displayPath(filePath) {
  return path.resolve(filePath);
}

function validatePackageTree(root, label, result) {
  const resources = path.join(root, "resources");
  const executable = path.join(root, "engram.exe");
  const llamaServer = path.join(resources, "llama", "bin", "llama-server.exe");

  if (!fileExists(executable)) {
    result.failures.push(`${label}: missing packaged executable ${displayPath(executable)}`);
  } else {
    const architecture = checkLlamaRuntimeArchitecture({
      executablePath: executable,
      platform: EXPECTED_PLATFORM,
      architecture: EXPECTED_ARCHITECTURE,
    });
    if (!architecture.ok) {
      result.failures.push(
        `${label}: packaged executable architecture check failed for ` +
          `${displayPath(executable)}: ${architecture.message}`,
      );
    } else {
      result.architectures[label] = architecture.architectures;
    }
  }

  if (!fileExists(llamaServer)) {
    result.failures.push(`${label}: missing llama server ${displayPath(llamaServer)}`);
  } else {
    const architecture = checkLlamaRuntimeArchitecture({
      executablePath: llamaServer,
      platform: EXPECTED_PLATFORM,
      architecture: EXPECTED_ARCHITECTURE,
    });
    if (!architecture.ok) {
      result.failures.push(
        `${label}: llama server architecture check failed for ` +
          `${displayPath(llamaServer)}: ${architecture.message}`,
      );
    } else {
      result.architectures[`${label} llama-server`] = architecture.architectures;
    }
  }

  for (const dll of WINDOWS_RUNTIME_FILES) {
    const dllPath = path.join(resources, "llama", "bin", dll);
    if (!fileExists(dllPath)) {
      result.failures.push(`${label}: missing required llama DLL ${displayPath(dllPath)}`);
    }
  }

  for (const resource of REQUIRED_RESOURCE_FILES) {
    const resourcePath = path.join(resources, resource);
    if (!fileExists(resourcePath)) {
      result.failures.push(`${label}: missing packaged resource ${displayPath(resourcePath)}`);
    }
  }

  const webDirectory = path.join(resources, "web");
  if (!directoryHasFiles(webDirectory)) {
    result.failures.push(`${label}: packaged web resource directory is empty ${displayPath(webDirectory)}`);
  }

  const defaultModel = path.join(resources, "llama", "model.gguf");
  if (fileExists(defaultModel)) {
    result.failures.push(
      `${label}: slim Windows package unexpectedly contains the default GGUF ${displayPath(defaultModel)}`,
    );
  }
}

export async function verifyWindowsZip({
  zipPath,
  unpackedDir,
  extractedDir,
  diagnosticsPath,
}) {
  const result = {
    ok: false,
    zipPath: displayPath(zipPath),
    unpackedDir: displayPath(unpackedDir),
    extractedDir: displayPath(extractedDir),
    zipSha256: null,
    zipBytes: null,
    executableSha256: {},
    architectures: {},
    failures: [],
  };

  try {
    if (!fileExists(zipPath)) {
      result.failures.push(`missing Windows portable ZIP ${result.zipPath}`);
    } else {
      result.zipSha256 = await sha256File(zipPath);
      result.zipBytes = statSync(zipPath).size;
    }

    validatePackageTree(unpackedDir, "win-unpacked", result);
    validatePackageTree(extractedDir, "windows-zip", result);

    const unpackedExecutable = path.join(unpackedDir, "engram.exe");
    const extractedExecutable = path.join(extractedDir, "engram.exe");
    if (fileExists(unpackedExecutable)) {
      result.executableSha256["win-unpacked"] = await sha256File(unpackedExecutable);
    }
    if (fileExists(extractedExecutable)) {
      result.executableSha256["windows-zip"] = await sha256File(extractedExecutable);
    }
    if (
      result.executableSha256["win-unpacked"] &&
      result.executableSha256["windows-zip"] &&
      result.executableSha256["win-unpacked"] !==
        result.executableSha256["windows-zip"]
    ) {
      result.failures.push(
        `Windows ZIP executable does not match win-unpacked: ` +
          `${displayPath(extractedExecutable)} has SHA-256 ` +
          `${result.executableSha256["windows-zip"]}, expected ` +
          `${result.executableSha256["win-unpacked"]} from ` +
          `${displayPath(unpackedExecutable)}`,
      );
    }
  } catch (error) {
    result.failures.push(
      `Windows ZIP completeness check could not inspect an artifact: ` +
        `${String(error?.message ?? error)}`,
    );
  } finally {
    result.ok = result.failures.length === 0;
    if (diagnosticsPath) {
      mkdirSync(path.dirname(diagnosticsPath), { recursive: true });
      writeFileSync(diagnosticsPath, `${JSON.stringify(result, null, 2)}\n`);
    }
  }

  if (!result.ok) {
    throw new Error(
      `Windows ZIP completeness check failed (ZIP SHA-256: ` +
        `${result.zipSha256 ?? "unavailable"}):\n- ${result.failures.join("\n- ")}`,
    );
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArguments(process.argv.slice(2));
  const required = ["zip", "unpacked", "extracted"];
  for (const name of required) {
    if (!args[name]) throw new Error(`Usage requires --${name} <path>.`);
  }

  try {
    const result = await verifyWindowsZip({
      zipPath: args.zip,
      unpackedDir: args.unpacked,
      extractedDir: args.extracted,
      diagnosticsPath: args.diagnostics,
    });
    console.log(
      `Windows ZIP completeness check passed: ${result.zipPath} ` +
        `(SHA-256 ${result.zipSha256}; ${result.zipBytes} bytes)`,
    );
    for (const [label, hash] of Object.entries(result.executableSha256)) {
      console.log(`${label} engram.exe SHA-256: ${hash}`);
    }
  } catch (error) {
    console.error(String(error?.stack ?? error));
    process.exitCode = 1;
  }
}