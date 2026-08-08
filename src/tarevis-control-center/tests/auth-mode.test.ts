import assert from "node:assert/strict";
import test from "node:test";
import { resolveAuthMode } from "../src/auth/auth-mode";

test("live deployments default to Access authentication", () => {
  assert.equal(resolveAuthMode("live"), "access");
  assert.equal(resolveAuthMode("live", "access"), "access");
});

test("local development can opt into mock authentication explicitly", () => {
  assert.equal(resolveAuthMode("mock"), "mock");
  assert.equal(resolveAuthMode("live", "mock"), "mock");
});

test("production cannot opt into mock authentication", () => {
  assert.equal(resolveAuthMode("mock", "mock", true), "access");
  assert.equal(resolveAuthMode("live", "mock", true), "access");
});
