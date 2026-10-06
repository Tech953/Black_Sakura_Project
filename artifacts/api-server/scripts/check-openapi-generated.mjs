import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describeGeneratedMismatch } from "./openapi-drift-utils.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, "../../..");
const stagingDirectories = [
  "lib/api-client-react/src/generated",
  "lib/api-zod/src/generated",
];

async function readGeneratedTree(directory, relativeDirectory = "") {
  const result = new Map();
  let entries;

  try {
    entries = await readdir(path.join(directory, relativeDirectory), {
      withFileTypes: true,
    });
  } catch (error) {
    if (error?.code === "ENOENT") return result;
    throw error;
  }

  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      const nested = await readGeneratedTree(directory, relativePath);
      for (const [nestedPath, contents] of nested) {
        result.set(nestedPath, contents);
      }
    } else if (entry.isFile()) {
      result.set(
        relativePath.split(path.sep).join("/"),
        await readFile(path.join(directory, relativePath), "utf8"),
      );
    }
  }

  return result;
}

async function main() {
  const stagingRoot = await mkdtemp(
    path.join(os.tmpdir(), "engram-openapi-check-"),
  );

  try {
    const stagedClientSource = path.join(
      stagingRoot,
      "lib/api-client-react/src",
    );
    await mkdir(stagedClientSource, { recursive: true });
    await copyFile(
      path.join(workspaceRoot, "lib/api-client-react/src/custom-fetch.ts"),
      path.join(stagedClientSource, "custom-fetch.ts"),
    );

    const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const generation = spawnSync(
      pnpmCommand,
      ["--filter", "@workspace/api-spec", "run", "codegen:staged"],
      {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          API_CODEGEN_STAGING_ROOT: stagingRoot,
        },
        stdio: "inherit",
        shell: process.platform === "win32",
      },
    );

    if (generation.error) throw generation.error;
    if (generation.status !== 0) {
      throw new Error(
        `Staged Orval generation failed (exit ${
          generation.status ?? generation.signal ?? "unknown"
        }).`,
      );
    }

    const mismatches = [];
    for (const relativeDirectory of stagingDirectories) {
      const currentDirectory = path.join(workspaceRoot, relativeDirectory);
      const stagedDirectory = path.join(stagingRoot, relativeDirectory);
      const [currentFiles, stagedFiles] = await Promise.all([
        readGeneratedTree(currentDirectory),
        readGeneratedTree(stagedDirectory),
      ]);
      const allPaths = [
        ...new Set([...currentFiles.keys(), ...stagedFiles.keys()]),
      ].sort();

      for (const relativeFile of allPaths) {
        const before = currentFiles.get(relativeFile);
        const after = stagedFiles.get(relativeFile);
        if (before === after) continue;

        const fullRelativePath = `${relativeDirectory}/${relativeFile}`;
        mismatches.push({
          path: fullRelativePath,
          description: describeGeneratedMismatch(
            fullRelativePath,
            before ?? "",
            after ?? "",
          ),
          state:
            before === undefined
              ? "missing from checked-in output"
              : after === undefined
                ? "not generated from the current spec"
                : "differs from current spec",
        });
      }
    }

    if (mismatches.length) {
      console.error("OpenAPI-generated artifacts are out of date:");
      for (const mismatch of mismatches) {
        console.error(
          `- ${mismatch.path}: ${mismatch.state} (${mismatch.description})`,
        );
      }
      console.error(
        "The repository was not modified. Regenerate intentionally with `pnpm --filter @workspace/api-spec run codegen`, review the generated diff, and rerun this check.",
      );
      process.exitCode = 1;
      return;
    }

    console.log(
      "OpenAPI-generated React client and Zod artifacts match the current spec.",
    );
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(
    `OpenAPI generated-artifact check failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
