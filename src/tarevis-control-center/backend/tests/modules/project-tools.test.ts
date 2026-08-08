import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { HarnessProject } from "../../src/modules/harness/harness-types.js";
import { HarnessPathAccessError } from "../../src/modules/harness/harness-types.js";
import { ProjectTools } from "../../src/modules/harness/project-tools.js";

test("project tools browse and search text while enforcing the selected root", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "tarevis-tools-"));
  try {
    const projectPath = join(tempRoot, "project");
    await mkdir(join(projectPath, "src"), { recursive: true });
    await mkdir(join(projectPath, ".agents"), { recursive: true });
    await mkdir(join(projectPath, "node_modules"), { recursive: true });
    await writeFile(join(projectPath, "src", "agent.ts"), [
      "export const agentName = 'TRAEVIS';",
      "export function browseProject() {",
      "  return agentName;",
      "}",
    ].join("\n"));
    await writeFile(join(projectPath, "README.md"), "# TRAEVIS\nAgent harness project browser.\n");
    await writeFile(join(projectPath, ".agents", "private.md"), "TRAEVIS");
    await writeFile(join(projectPath, "node_modules", "ignored.js"), "TRAEVIS");
    const project: HarnessProject = {
      id: "project",
      name: "Project",
      path: projectPath,
      createdAt: "2026-08-04T00:00:00.000Z",
      updatedAt: "2026-08-04T00:00:00.000Z",
    };
    const tools = new ProjectTools();

    const root = await tools.listDirectory(project);
    assert.deepEqual(root.entries.map((entry) => entry.name), ["src", "README.md"]);
    const file = await tools.readFile(project, "src/agent.ts", { startLine: 2, endLine: 3 });
    assert.equal(file.content, "export function browseProject() {\n  return agentName;");
    assert.equal(file.truncated, true);

    const search = await tools.searchFiles(project, { query: "TRAEVIS", filePattern: "*.ts" });
    assert.equal(search.matches.length, 1);
    assert.equal(search.matches[0].path, "src/agent.ts");
    await assert.rejects(() => tools.listDirectory(project, ".."), HarnessPathAccessError);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
