import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(
  import.meta.dirname,
  "../../../.github/workflows/desktop-build.yml",
);
const workflow = readFileSync(workflowPath, "utf8");
const builderConfigPath = resolve(
  import.meta.dirname,
  "../electron-builder.yml",
);
const builderConfig = readFileSync(builderConfigPath, "utf8");

function getJobSection(name) {
  const jobs = [...workflow.matchAll(/^  [a-z][a-z0-9-]*:/gm)];
  const start = jobs.find((match) => match[0] === `  ${name}:`)?.index;
  if (start == null) return "";
  const nextStart = jobs.find((match) => match.index > start)?.index;
  return workflow.slice(start, nextStart ?? workflow.length);
}

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
  it("creates one workflow-attempt-owned draft before the build matrix", () => {
    const prepareJob = getJobSection("prepare-draft");
    const buildJob = getJobSection("build");

    expect(prepareJob).toContain(
      "if: github.event_name == 'push' && github.ref_type == 'tag'",
    );
    expect(prepareJob).toMatch(
      /OWNER_ID:\s*\$\{\{\s*github\.run_id\s*\}\}-\$\{\{\s*github\.run_attempt\s*\}\}/,
    );
    expect(prepareJob).toContain(
      'OWNER_MARKER="<!-- engram-draft-owner:${OWNER_ID} -->"',
    );
    expect(prepareJob).toMatch(/-f body="\$OWNER_MARKER"/);
    expect(prepareJob).toMatch(
      /Refusing to reuse same-tag draft\(s\).*not uniquely owned/s,
    );
    expect(prepareJob).toContain("a published release already uses this tag");
    expect(buildJob).toMatch(/needs:\s*prepare-draft/);
    expect(buildJob).toContain("github.event_name == 'workflow_dispatch'");
    expect(getJobSection("android")).toContain(
      "github.event_name == 'workflow_dispatch'",
    );
    expect(builderConfig).toContain("releaseType: draft");
    expect(builderConfig).toContain("workflow-attempt owner marker");
  });

  it("makes Android attachment, publication, and cleanup verify the same owner", () => {
    const androidJob = getJobSection("android");
    const publishJob = getJobSection("publish");
    const cleanupJob = getJobSection("cleanup-draft");

    expect(androidJob).toContain(
      "RELEASE_ID: ${{ needs.prepare-draft.outputs.release_id }}",
    );
    expect(androidJob).toMatch(
      /\.draft == true and \.tag_name == \$tag and \(\(\.body \/\/ ""\) \| contains\(\$owner\)\)/,
    );
    expect(publishJob).toContain(
      "DRAFT_RELEASE_ID: ${{ needs.prepare-draft.outputs.release_id }}",
    );
    expect(publishJob).toMatch(
      /\.draft == true and \.tag_name == \$tag and \(\(\.body \/\/ ""\) \| contains\(\$owner\)\)/,
    );
    expect(cleanupJob).toMatch(
      /\.draft == true and \.tag_name == \$tag and \(\(\.body \/\/ ""\) \| contains\(\$owner\)\)/,
    );
    expect(cleanupJob).toMatch(
      /CURRENT_RELEASE="\$\(gh api "repos\/\$REPO\/releases\/\$RELEASE_ID"\)[\s\S]*contains\(\$owner\)[\s\S]*gh api -X DELETE/s,
    );
  });

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
    const cleanupJob = getJobSection("cleanup-draft");
    expect(cleanupJob).toContain("github.event_name == 'push'");
    expect(cleanupJob).toContain("github.ref_type == 'tag'");
    expect(cleanupJob).toMatch(/\(failure\(\) \|\| cancelled\(\)\)/);
    expect(cleanupJob).not.toContain("workflow_dispatch");
    expect(workflow).toMatch(
      /if:\s*github\.event_name\s*==\s*'push'\s*&&\s*github\.ref_type\s*==\s*'tag'\s*&&\s*needs\.build\.result\s*==\s*'success'/,
    );
  });

  it("summarizes cleanup outcomes and fails on deletion errors", () => {
    expect(workflow).toContain('>> "$GITHUB_STEP_SUMMARY"');
    expect(workflow).toMatch(/Owned drafts found:/);
    expect(workflow).toMatch(/Release IDs deleted:/);
    expect(workflow).toMatch(/already clean/);
    expect(workflow).toMatch(
      /if gh api -X DELETE "repos\/\$REPO\/releases\/\$RELEASE_ID"; then/,
    );
    expect(workflow).toMatch(
      /write_summary "failed" "\$FOUND_COUNT" "\$DELETED_LIST" "\$FAILED_LIST" "\$SKIPPED_LIST"/,
    );
    expect(workflow).toMatch(/exit 1/);
  });

  it("rejects a signed macOS app from an unexpected Apple team", () => {
    expect(workflow).toMatch(
      /APP_DETAILS="\$\(codesign -dv --verbose=4 "\$APP" 2>&1\)/,
    );
    expect(workflow).toMatch(
      /ACTUAL_APPLE_TEAM_ID=.*sed -n 's\/\^TeamIdentifier=\/\/p'/,
    );
    expect(workflow).toMatch(/if \[ -n "\$\{APPLE_TEAM_ID:-\}" \]; then/);
    expect(workflow).toMatch(
      /if \[ "\$ACTUAL_APPLE_TEAM_ID" != "\$APPLE_TEAM_ID" \]; then/,
    );
    expect(workflow).toMatch(
      /macOS app signing identity .*uses Apple team .*expected/,
    );
    expect(workflow).toMatch(
      /APPLE_TEAM_ID is not configured; skipping expected Apple team identity verification/,
    );
  });

  it("requires bundled macOS executables to share the app signer", () => {
    expect(workflow).toMatch(
      /BUNDLED_BINARIES=\(\s*"\$APP\/Contents\/Resources\/bin\/ffmpeg"\s*"\$APP\/Contents\/Resources\/bin\/ffprobe"\s*\)/s,
    );
    expect(workflow).toMatch(
      /LLAMA_SERVER="\$APP\/Contents\/Resources\/llama\/bin\/llama-server"/,
    );
    expect(workflow).toMatch(
      /if \[ -f "\$LLAMA_SERVER" \]; then\s+BUNDLED_BINARIES\+=\("\$LLAMA_SERVER"\)/s,
    );
    expect(workflow).toMatch(
      /BINARY_SIGNING_IDENTITY=.*sed -n 's\/\^Authority=\/\/p'/,
    );
    expect(workflow).toMatch(
      /BINARY_APPLE_TEAM_ID=.*sed -n 's\/\^TeamIdentifier=\/\/p'/,
    );
    expect(workflow).toMatch(
      /if \[ "\$BINARY_SIGNING_IDENTITY" != "\$APP_SIGNING_IDENTITY" \] \|\|[\s\S]*"\$BINARY_APPLE_TEAM_ID" != "\$ACTUAL_APPLE_TEAM_ID"/,
    );
    expect(workflow).toMatch(
      /Nested executable .*uses signer .*expected app signer/,
    );
  });

  it("verifies video tools after silent NSIS installation", () => {
    expect(workflow).toMatch(
      /- name: Verify installed NSIS video tool signatures/,
    );
    expect(workflow).toMatch(/-ArgumentList @\("\/S", "\/D=\$installDir"\)/);
    expect(workflow).toMatch(
      /Join-Path \$installDir "resources\\bin\\ffmpeg\.exe"/,
    );
    expect(workflow).toMatch(
      /Join-Path \$installDir "resources\\bin\\ffprobe\.exe"/,
    );
    expect(workflow).toMatch(
      /Get-AuthenticodeSignature \(Resolve-Path \$file\)\.Path/,
    );
    expect(workflow).toMatch(
      /NSIS installed video-tool verification failed \(installer: \$reportedInstaller\)/,
    );
    expect(workflow).toMatch(
      /finally \{[\s\S]*Remove-Item -LiteralPath \$installDir -Recurse -Force/,
    );
  });

  it("requires timestamp signer certificates for Windows video tools", () => {
    const timestampChecks =
      workflow.match(/\$signature\.TimeStamperCertificate/g) ?? [];
    expect(timestampChecks.length).toBeGreaterThanOrEqual(2);
    expect(workflow).toMatch(
      /if \(\$null -eq \$signature\.TimeStamperCertificate\) \{\s+throw "Bundled video tool is missing an Authenticode timestamp signer certificate: \$file"/s,
    );
    expect(workflow).toMatch(
      /if \(\$null -eq \$signature\.TimeStamperCertificate\) \{\s+throw "Installed video tool is missing an Authenticode timestamp signer certificate: \$file"/s,
    );
    expect(workflow).toMatch(
      /timestamp signer: \$\(\$signature\.TimeStamperCertificate\.Subject\)/,
    );
  });

  it("extracts and verifies the Windows portable ZIP before smoke testing", () => {
    expect(workflow).toMatch(
      /- name: Verify Windows portable ZIP completeness/,
    );
    expect(workflow).toMatch(
      /id: windows_zip_check[\s\S]*Expand-Archive -LiteralPath \$zip\.FullName -DestinationPath \$extractDir -Force/,
    );
    expect(workflow).toMatch(
      /run verify:windows-zip -- [\s\S]*--unpacked \(Join-Path \$releaseDir "win-unpacked"\)[\s\S]*--extracted \$extractDir[\s\S]*--diagnostics \$diagnosticsPath/,
    );
    expect(workflow).toMatch(
      /- name: Collect packaged smoke diagnostics\s+if: always\(\)/,
    );
  });

  it("uploads bounded diagnostics and verifies an expected failure on native runners", () => {
    const buildStart = workflow.indexOf("\n  build:");
    const buildEnd = workflow.indexOf(
      "\n  llama-runtime-contract:",
      buildStart,
    );
    const buildJob = workflow.slice(buildStart, buildEnd);

    expect(buildJob).toMatch(
      /- name: Probe packaged failure diagnostics\s+id: packaged_diagnostics_probe\s+if: always\(\) && steps\.packaged_smoke\.outcome == 'success'\s+continue-on-error: true[\s\S]*ENGRAM_PACKAGED_DIAGNOSTICS_PROBE:\s+"1"/,
    );
    expect(buildJob).toMatch(
      /intentional diagnostics probe: health check failure/,
    );
    expect(buildJob).toMatch(
      /- name: Collect packaged smoke diagnostics\s+if: always\(\)[\s\S]*collect-smoke-diagnostics\.mjs/,
    );
    expect(buildJob).toMatch(
      /- name: Verify packaged failure diagnostics\s+if: always\(\) && steps\.packaged_diagnostics_probe\.outcome == 'failure'[\s\S]*verify-smoke-diagnostics\.mjs/,
    );
    expect(buildJob).toMatch(
      /- name: Upload packaged smoke diagnostics\s+if: always\(\)/,
    );
    expect(buildJob).not.toContain(
      "steps.windows_zip_check.outcome == 'failure'",
    );
  });

  it("runs fixture cache tests before the pre-release packaged smoke", () => {
    const preReleaseJob = workflow.indexOf("\n  pre-release-smoke:");
    const fixtureTests = workflow.indexOf(
      "- name: Run desktop fixture cache tests",
      preReleaseJob,
    );
    const packagedSmoke = workflow.indexOf(
      "- name: Smoke test packaged app",
      preReleaseJob,
    );

    expect(preReleaseJob).toBeGreaterThanOrEqual(0);
    expect(fixtureTests).toBeGreaterThan(preReleaseJob);
    expect(packagedSmoke).toBeGreaterThan(fixtureTests);
    expect(workflow.slice(fixtureTests, packagedSmoke)).toContain(
      "pnpm --filter @workspace/desktop run test",
    );
  });
});
