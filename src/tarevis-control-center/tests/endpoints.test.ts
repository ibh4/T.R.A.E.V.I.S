import assert from "node:assert/strict";
import test from "node:test";
import {
  controlCenterHttpUrl,
  controlCenterWebSocketUrl,
} from "../src/control/endpoints";

test("production API and websocket endpoints preserve device routing", () => {
  assert.equal(
    controlCenterHttpUrl("https://api.example.com/", "api/state", "my-computer", "https://app.example.com"),
    "https://api.example.com/api/state?deviceId=my-computer",
  );
  assert.equal(
    controlCenterWebSocketUrl("https://api.example.com/", "my-computer", "https://app.example.com"),
    "wss://api.example.com/ws?deviceId=my-computer",
  );
});

test("local relative endpoints use ws and retain existing query parameters", () => {
  assert.equal(
    controlCenterHttpUrl("/", "api/harness/projects/project-1/tree?path=src", "local-pc", "http://127.0.0.1:5180"),
    "http://127.0.0.1:5180/api/harness/projects/project-1/tree?path=src&deviceId=local-pc",
  );
  assert.equal(
    controlCenterWebSocketUrl("/", "local-pc", "http://127.0.0.1:5180"),
    "ws://127.0.0.1:5180/ws?deviceId=local-pc",
  );
});
