/**
 * Keep API tests independent from the workspace's optional cloud integration.
 *
 * `llm.ts` intentionally fails fast when a production endpoint is missing. Test
 * modules that exercise routes or stores may still import that seam indirectly,
 * though, so give the test process a local-only sentinel before the module graph
 * loads. Tests that need to prove the unconfigured path clear this value
 * explicitly (the generation-client tests do so per test).
 */
if (
  !process.env.LLM_BASE_URL &&
  !process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
) {
  process.env.LLM_BASE_URL = "http://127.0.0.1:9/v1";
}