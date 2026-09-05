import path from "node:path";

export interface LlamaCommandOptions {
  executablePath: string;
  modelPath: string;
  port: number;
  context: number;
}

export interface LlamaCommand {
  args: string[];
  cwd: string;
}

function requireAbsoluteFilePath(value: string, name: string): void {
  if (!value || value.includes("\0") || !path.isAbsolute(value)) {
    throw new TypeError(`${name} must be an absolute path without NUL bytes`);
  }
}

/** Constructs spawn arguments without ever involving a command shell. */
export function buildLlamaCommand(options: LlamaCommandOptions): LlamaCommand {
  requireAbsoluteFilePath(options.executablePath, "executablePath");
  requireAbsoluteFilePath(options.modelPath, "modelPath");
  if (path.extname(options.modelPath).toLowerCase() !== ".gguf") {
    throw new TypeError("modelPath must end in .gguf");
  }
  if (
    !Number.isInteger(options.port) ||
    options.port < 1 ||
    options.port > 65_535
  ) {
    throw new RangeError("port must be an integer from 1 through 65535");
  }
  if (
    !Number.isInteger(options.context) ||
    options.context < 512 ||
    options.context > 131_072
  ) {
    throw new RangeError("context must be an integer from 512 through 131072");
  }

  return {
    args: [
      "-m",
      options.modelPath,
      "--host",
      "127.0.0.1",
      "--port",
      String(options.port),
      "-c",
      String(options.context),
      "--no-webui",
    ],
    cwd: path.dirname(options.executablePath),
  };
}