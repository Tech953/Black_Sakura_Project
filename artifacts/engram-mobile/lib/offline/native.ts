import type * as LlamaModuleNamespace from "llama.rn";

export type LlamaModule = typeof LlamaModuleNamespace;

/** Keep the native-only require behind a local seam so tests never load JSI. */
export function loadLlamaModule(): LlamaModule {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("llama.rn") as LlamaModule;
}