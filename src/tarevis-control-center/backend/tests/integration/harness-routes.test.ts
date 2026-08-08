import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createControlCenterServer } from "../../src/server.js";

test("harness HTTP API manages projects, browses files, and reports missing model configuration", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "tarevis-routes-"));
  const projectPath = join(tempRoot, "project");
  await mkdir(join(projectPath, "src"), { recursive: true });
  await writeFile(join(projectPath, "src", "index.ts"), "export const ready = true;\n");
  const app = createControlCenterServer({
    host: "127.0.0.1",
    port: 0,
    mode: "mock",
    logLevel: "error",
    harness: {
      projectsFile: join(tempRoot, "projects.json"),
      defaultProjectPath: projectPath,
      qwen: {
        baseUrl: "https://example.invalid/v1",
        model: "qwen-test",
        timeoutMs: 5_000,
        maxSteps: 3,
      },
    },
  });
  try {
    const address = await app.start();
    const baseUrl = `http://${address.host}:${address.port}`;
    const status = await (await fetch(`${baseUrl}/api/harness/status`)).json();
    assert.deepEqual(status, {
      configured: false,
      model: "qwen-test",
      provider: "qwen",
      readOnly: true,
      projectCount: 1,
    });

    const listingResponse = await fetch(
      `${baseUrl}/api/harness/projects/tarevis-control-center/tree?path=src`,
    );
    assert.equal(listingResponse.status, 200);
    const listing = await listingResponse.json();
    assert.equal(listing.entries[0].path, "src/index.ts");

    const fileResponse = await fetch(
      `${baseUrl}/api/harness/projects/tarevis-control-center/file?path=src%2Findex.ts`,
    );
    assert.equal(fileResponse.status, 200);
    assert.equal((await fileResponse.json()).content, "export const ready = true;\n");

    const escaped = await fetch(
      `${baseUrl}/api/harness/projects/tarevis-control-center/tree?path=..`,
    );
    assert.equal(escaped.status, 403);
    assert.equal((await escaped.json()).error.code, "PATH_OUTSIDE_PROJECT");

    const chat = await fetch(`${baseUrl}/api/harness/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "tarevis-control-center",
        message: "这个项目是什么？",
        history: [],
      }),
    });
    assert.equal(chat.status, 503);
    assert.equal((await chat.json()).error.code, "MODEL_NOT_CONFIGURED");
  } finally {
    await app.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
