import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(
  import.meta.dirname,
  "../../../.github/workflows/desktop-build.yml",
);
const workflow = readFileSync(workflowPath, "utf8");

const failedTagAttemptWithQueuedRetry = {
  failedAttempt: {
    ref: "refs/tags/v9.9.9",
    refType: "tag",
    draftReleaseId: 4101,
    result: "failure",
  },
  retryAttempt: {
    ref: "refs/tags/v9.9.9",
    refType: "tag",
    draftReleaseId: 4102,
    result: "queued",
  },
};

describe("desktop release workflow concurrency", () => {
  it("keeps a same-tag retry behind failed draft cleanup", () => {
    expect(workflow).toMatch(
      /group:\s*desktop-build-\$\{\{\s*github\.ref\s*\}\}/,
    );
    expect(workflow).toMatch(
      /cancel-in-progress:\s*\$\{\{\s*github\.ref_type\s*!=\s*'tag'\s*\}\}/,
    );

    expect(failedTagAttemptWithQueuedRetry.failedAttempt.ref).toBe(
      failedTagAttemptWithQueuedRetry.retryAttempt.ref,
    );
    expect(failedTagAttemptWithQueuedRetry.failedAttempt.refType).toBe("tag");
    expect(failedTagAttemptWithQueuedRetry.retryAttempt.result).toBe("queued");
    expect(
      failedTagAttemptWithQueuedRetry.failedAttempt.draftReleaseId,
    ).not.toBe(failedTagAttemptWithQueuedRetry.retryAttempt.draftReleaseId);
  });

  it("keeps manual runs excluded from draft cleanup", () => {
    expect(workflow).toMatch(
      /if:\s*github\.event_name\s*==\s*'push'\s*&&\s*github\.ref_type\s*==\s*'tag'\s*&&\s*failure\(\)/,
    );
    expect(workflow).toMatch(
      /if:\s*github\.event_name\s*==\s*'push'\s*&&\s*github\.ref_type\s*==\s*'tag'\s*&&\s*needs\.build\.result\s*==\s*'success'/,
    );
    expect(workflow).toMatch(
      /github\.event_name\s*==\s*'push'\s*&&\s*github\.ref_type\s*==\s*'tag'\s*&&\s*'always'/,
    );
  });
});
