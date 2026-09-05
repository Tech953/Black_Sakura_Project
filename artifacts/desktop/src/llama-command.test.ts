import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildLlamaCommand } from "./llama-command";

describe("buildLlamaCommand", () => {
  it("returns the exact fixed, loopback-only argv and executable directory", () => {
    const executablePath = path.resolve("/opt/llama/bin/llama-server");
    const modelPath = path.resolve("/models/safe model.gguf");
    expect(
      buildLlamaCommand({ executablePath, modelPath, port: 8081, context: 8192 }),
    ).toEqual({
      cwd: path.dirname(executablePath),
      args: [
        "-m",
        modelPath,
        "--host",
        "127.0.0.1",
        "--port",
        "8081",
        "-c",
        "8192",
        "--no-webui",
      ],
    });
  });

  it.each([
    { executablePath: "llama-server", modelPath: "/m.gguf", port: 1, context: 512 },
    { executablePath: "/llama", modelPath: "../m.gguf", port: 1, context: 512 },
    { executablePath: "/llama", modelPath: "/m.bin", port: 1, context: 512 },
    { executablePath: "/llama\0x", modelPath: "/m.gguf", port: 1, context: 512 },
    { executablePath: "/llama", modelPath: "/m.gguf", port: 0, context: 512 },
    { executablePath: "/llama", modelPath: "/m.gguf", port: 65536, context: 512 },
    { executablePath: "/llama", modelPath: "/m.gguf", port: 4.2, context: 512 },
    { executablePath: "/llama", modelPath: "/m.gguf", port: 1, context: 511 },
    { executablePath: "/llama", modelPath: "/m.gguf", port: 1, context: 131073 },
  ])("rejects invalid input %#", (input) => {
    expect(() => buildLlamaCommand(input)).toThrow();
  });
});