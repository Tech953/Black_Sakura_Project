/**
 * Keep API tests independent from the workspace's optional cloud integration.
 *
 * `llm.ts` intentionally fails fast when a production endpoint is missing. Test
 * modules that exercise routes or stores may still import that seam indirectly,
 * though, so give the test process a local-only sentinel before the module graph
 * loads. Tests that need to prove the unconfigured path clear this value
 * explicitly (the generation-client tests do so per test).
 */
const providerEnvNames = [
  "GENERATION_BASE_URL",
  "GENERATION_API_KEY",
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "AI_INTEGRATIONS_OPENAI_BASE_URL",
  "AI_INTEGRATIONS_OPENAI_API_KEY",
] as const;

const configuredProviderEnv = providerEnvNames.filter(
  (name) => process.env[name],
);

if (
  process.env.API_TEST_NO_CLOUD_PROVIDER === "1" &&
  configuredProviderEnv.length > 0
) {
  throw new Error(
    `[api-test-env] API_TEST_NO_CLOUD_PROVIDER=1 requires provider variables to be unset; found ${configuredProviderEnv.join(", ")}`,
  );
}

if (!process.env.LLM_BASE_URL && !process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
  process.env.LLM_BASE_URL = "http://127.0.0.1:9/v1";
}

/**
 * Keep accidental provider calls inside the test process. Local HTTP doubles
 * remain available for tests that intentionally start a loopback server, while
 * cloud requests fail before DNS resolution or credential transmission.
 */
const originalFetch = globalThis.fetch?.bind(globalThis);
if (originalFetch) {
  globalThis.fetch = (async (input, init) => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const url = new URL(rawUrl, "http://127.0.0.1");
    const localHost =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "0.0.0.0" ||
      url.hostname === "::1";

    if (!["http:", "https:"].includes(url.protocol) || localHost) {
      return originalFetch(input, init);
    }

    throw new Error(
      `[api-test-network] blocked external HTTP request to ${url.hostname}; use a loopback test double`,
    );
  }) as typeof fetch;
}
