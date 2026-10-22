import assert from "node:assert/strict";
import test from "node:test";
import { describeGeneratedMismatch } from "./openapi-drift-utils.mjs";

test("reports the endpoint path and operation when generated client output drifts", () => {
  const before = `
export const getEngramStateUrl = () => {
  return \`/engrams/\${id}/state\`;
};
export const getEngramState = async () => {
  return customFetch();
};
`;
  const after = `
export const getEngramStateUrl = () => {
  return \`/engrams/\${id}/live-state\`;
};
export const getEngramState = async () => {
  return customFetch();
};
`;

  const description = describeGeneratedMismatch(
    "lib/api-client-react/src/generated/api.ts",
    before,
    after,
  );

  assert.match(description, /\/engrams\/\{id\}\/live-state/);
  assert.match(description, /getEngramStateUrl/);
});

test("reports a changed Zod schema by its schema name", () => {
  const description = describeGeneratedMismatch(
    "lib/api-zod/src/generated/types/engramLiveState.ts",
    "export interface EngramLiveState { ready: boolean; }\n",
    "export interface EngramLiveState { ready: boolean; topCharge: number; }\n",
  );

  assert.match(description, /Zod schema engramLiveState/);
  assert.match(description, /EngramLiveState/);
});

test("reports a newly generated endpoint by its path and operation", () => {
  const description = describeGeneratedMismatch(
    "lib/api-client-react/src/generated/api.ts",
    "",
    `export const listHubSpacesUrl = () => {
  return "/hub/spaces";
};
`,
  );

  assert.match(description, /endpoint\(s\) \/hub\/spaces/);
  assert.match(description, /listHubSpacesUrl/);
});

test("reports a removed schema by its schema name", () => {
  const description = describeGeneratedMismatch(
    "lib/api-zod/src/generated/types/engramLiveState.ts",
    "export interface EngramLiveState { ready: boolean; }\n",
    "",
  );

  assert.match(description, /Zod schema engramLiveState/);
  assert.match(description, /EngramLiveState/);
});
