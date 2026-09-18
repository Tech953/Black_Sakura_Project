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

  it("summarizes cleanup outcomes and fails on deletion errors", () => {
    expect(workflow).toContain('>> "$GITHUB_STEP_SUMMARY"');
    expect(workflow).toMatch(/Matching drafts found:/);
    expect(workflow).toMatch(/Release IDs deleted:/);
    expect(workflow).toMatch(/already clean/);
    expect(workflow).toMatch(
      /if gh api -X DELETE "repos\/\$REPO\/releases\/\$RELEASE_ID"; then/,
    );
    expect(workflow).toMatch(
      /write_summary "failed" "\$FOUND_COUNT" "\$DELETED_LIST" "\$FAILED_LIST"/,
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
    expect(workflow).toMatch(
      /if \[ -n "\$\{APPLE_TEAM_ID:-\}" \]; then/,
    );
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
    expect(workflow).toMatch(
      /-ArgumentList @\("\/S", "\/D=\$installDir"\)/,
    );
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
    expect(workflow).toMatch(
      /steps\.windows_zip_check\.outcome == 'failure'/,
    );
  });
});
