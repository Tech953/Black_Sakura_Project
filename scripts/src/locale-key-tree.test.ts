import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  diffKeyTrees,
  findEnglishFallbackKeys,
  keysMatch,
} from "./locale-key-tree.js";

describe("locale key tree comparison", () => {
  it("accepts translated values when their structure is unchanged", () => {
    const english = { mobile: { title: "Settings", count: "{{count}} items" } };
    const translated = {
      mobile: { title: "Configuración", count: "{{count}} elementos" },
    };
    assert.equal(keysMatch(english, translated), true);
  });

  it("reports nested missing, extra, and structurally invalid keys", () => {
    const english = {
      mobile: {
        title: "Settings",
        nested: { saved: "Saved" },
        status: "Ready",
      },
    };
    const generated = {
      mobile: {
        nested: { removed: "Eliminado" },
        status: { ready: "Listo" },
        obsolete: "Old",
      },
    };
    assert.deepEqual(diffKeyTrees(english, generated), {
      missing: ["mobile.nested.saved", "mobile.title"],
      extra: ["mobile.nested.removed", "mobile.obsolete"],
      typeMismatches: [
        "mobile.status (expected string, got object)",
      ],
    });
  });

  it("reports English fallback values only for tracked mobile labels", () => {
    const english = {
      tabs: { hub: "Hub" },
      hub: {
        kicker: "ENGRAM // HUB",
        title: "Telemetry",
        noActivity: "No Hub activity yet.",
        unrelated: "Existing English copy",
      },
      environment: {
        unavailable: "Environment unavailable",
      },
    };
    const generated = {
      tabs: { hub: "Hub" },
      hub: {
        kicker: "ENGRAM // HUB",
        title: "Telemetry",
        noActivity: "Aucune activité Hub pour le moment.",
        unrelated: "Existing English copy",
      },
      environment: {
        unavailable: "Environment unavailable",
      },
    };

    assert.deepEqual(findEnglishFallbackKeys(english, generated), [
      "hub.title",
      "environment.unavailable",
    ]);
  });

  it("allows product terms alone but still flags English copy around them", () => {
    const mobile = {
      tabs: { hub: "Hub" },
      hub: {
        kicker: "ENGRAM // HUB",
        title: "PYRI",
        live: "engram",
        noActivity: "No Hub activity yet.",
      },
    };

    assert.deepEqual(findEnglishFallbackKeys(mobile, mobile), [
      "hub.noActivity",
    ]);
  });
});