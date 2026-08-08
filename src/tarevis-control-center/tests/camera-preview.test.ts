import assert from "node:assert/strict";
import test from "node:test";
import { resolveCameraPreviewConfiguration } from "../src/control/camera-preview";

test("camera preview accepts HTTPS and same-origin relative URLs", () => {
  assert.deepEqual(
    resolveCameraPreviewConfiguration(
      "https://home-node.example.ts.net:8787/media/preview.mjpg",
      "https://control.example.com/console/devices",
    ),
    {
      url: "https://home-node.example.ts.net:8787/media/preview.mjpg",
      issue: null,
      host: "home-node.example.ts.net:8787",
    },
  );
  assert.deepEqual(
    resolveCameraPreviewConfiguration("/media/preview.mjpg", "http://127.0.0.1:5180/console/devices"),
    {
      url: "http://127.0.0.1:5180/media/preview.mjpg",
      issue: null,
      host: "127.0.0.1:5180",
    },
  );
});

test("camera preview rejects insecure, credentialed, and unsupported endpoints", () => {
  assert.equal(
    resolveCameraPreviewConfiguration("http://100.64.0.2:8787/media/preview.mjpg", "https://control.example.com").issue,
    "mixed-content",
  );
  assert.equal(
    resolveCameraPreviewConfiguration("https://user:pass@home-node.example/media/preview.mjpg", "https://control.example.com").issue,
    "embedded-credentials",
  );
  assert.equal(
    resolveCameraPreviewConfiguration("rtsp://home-node.example/cam", "https://control.example.com").issue,
    "unsupported-protocol",
  );
  assert.equal(resolveCameraPreviewConfiguration(undefined, "https://control.example.com").issue, "not-configured");
});
