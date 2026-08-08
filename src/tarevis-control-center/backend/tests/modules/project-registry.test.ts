import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectRegistry } from "../../src/modules/harness/project-registry.js";

test("project registry seeds, persists, updates, and removes editable project paths", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "tarevis-registry-"));
  try {
    const defaultProject = join(tempRoot, "default-project");
    const secondProject = join(tempRoot, "second-project");
    await mkdir(defaultProject);
    await mkdir(secondProject);
    const filePath = join(tempRoot, "data", "projects.local.json");
    const registry = new ProjectRegistry({
      filePath,
      defaultProjectPath: defaultProject,
      createId: () => "project-2",
      now: () => new Date("2026-08-04T12:00:00.000Z"),
    });

    const seeded = await registry.list();
    assert.equal(seeded.length, 1);
    assert.equal(seeded[0].id, "tarevis-control-center");
    assert.equal(seeded[0].path, defaultProject);

    const created = await registry.create({ name: "Second", path: secondProject });
    assert.equal(created.id, "project-2");
    const updated = await registry.update("project-2", { name: "Renamed" });
    assert.equal(updated.name, "Renamed");
    assert.equal(updated.path, secondProject);

    const reloaded = new ProjectRegistry({ filePath, defaultProjectPath: defaultProject });
    assert.deepEqual((await reloaded.list()).map((project) => project.name), [
      "TRAEVIS Competition",
      "Renamed",
    ]);
    await reloaded.remove("project-2");
    assert.equal((await reloaded.list()).length, 1);

    const persisted = JSON.parse(await readFile(filePath, "utf8")) as { version: number; projects: unknown[] };
    assert.equal(persisted.version, 1);
    assert.equal(persisted.projects.length, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
