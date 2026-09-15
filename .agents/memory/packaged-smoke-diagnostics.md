---
name: Packaged desktop smoke diagnostics
description: Failure evidence for Electron packaged smoke runs must remain bounded, redacted, and available before child startup or health.
---

Packaged smoke diagnostics should be emitted from both the workflow and the Electron main process. The workflow must tee the smoke output, collect relative staged-resource listings, and upload the directory with an always-run step. The main process should capture server and local-model stdout/stderr into separate bounded files when the CI diagnostics directory is enabled.

**Why:** The most useful failures happen before a renderer exists, when a child exits before health, or when the launch watchdog fires. Console output alone is easy to lose, and raw CI output can expose machine paths or credentials.

**How to apply:** Keep diagnostics CI-only, sanitize workspace/home/temp paths and credential-shaped values before writing, cap every log, and never make diagnostics failure block normal app startup. Do not upload absolute resource paths; list staged resources relative to the checkout.

For packaged network fixtures, write a bounded evidence file during lifecycle cleanup with the request sequence, trust configuration, path checkpoints, and phase-labeled failure.

**Why:** A Windows model-download failure can occur after redirects, certificate setup, partial-file writes, or removal, and the final console excerpt does not identify which boundary failed.

**How to apply:** Update the evidence while the fixture is active so thrown failures preserve the latest request/path state; sanitize temp and credential-shaped values before writing, and upload it only for the relevant failed smoke job.