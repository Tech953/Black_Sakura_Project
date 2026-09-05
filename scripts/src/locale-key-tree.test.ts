import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { diffKeyTrees, keysMatch } from "./locale-key-tree.js";

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
});