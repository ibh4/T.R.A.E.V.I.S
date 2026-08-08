import assert from "node:assert/strict";
import test from "node:test";
import {
  CompositionRoot,
  resolveTraeAdapter,
} from "../../src/core/composition-root.js";
import type { RuntimeMode, TraeAdapterSelection } from "../../src/config.js";

test("TRAE adapter selection follows the frozen mode matrix", () => {
  const cases: Array<{
    mode: RuntimeMode;
    traeAdapter?: TraeAdapterSelection;
    expected: "mock" | "communicate" | "unavailable";
  }> = [
    { mode: "mock", expected: "mock" },
    { mode: "mock", traeAdapter: "mock", expected: "mock" },
    { mode: "mock", traeAdapter: "communicate", expected: "mock" },
    { mode: "hybrid", expected: "mock" },
    { mode: "hybrid", traeAdapter: "mock", expected: "mock" },
    { mode: "hybrid", traeAdapter: "communicate", expected: "communicate" },
    { mode: "live", expected: "unavailable" },
    { mode: "live", traeAdapter: "mock", expected: "unavailable" },
    { mode: "live", traeAdapter: "communicate", expected: "communicate" },
  ];

  for (const { expected, ...config } of cases) {
    assert.equal(resolveTraeAdapter(config), expected, JSON.stringify(config));
  }
});

test("communicate selection rejects missing Bridge configuration before composition", () => {
  assert.throws(() => new CompositionRoot({
    host: "127.0.0.1",
    port: 0,
    mode: "hybrid",
    logLevel: "error",
    traeAdapter: "communicate",
  }), /TRAE communicate configuration is required/);
});
