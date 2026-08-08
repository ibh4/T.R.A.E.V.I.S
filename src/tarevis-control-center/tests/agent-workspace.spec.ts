import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const controlCenterRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(controlCenterRoot, "..", "..");

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: "进入中控台" }).click();
  await expect(page).toHaveURL(/\/console\/overview$/);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
}

test("Agent workspace manages project roots and browses repository files responsively", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.getByRole("button", { name: "TRAE 状态" }).first().click();
  await page.screenshot({ path: path.join(tmpdir(), "tarevis-console-reference.png"), fullPage: true });
  await page.getByRole("button", { name: "Agent 工作台" }).first().click();
  await expect(page.getByRole("heading", { name: "Agent 工作台" })).toBeVisible();

  await expect(page.getByText("QWEN KEY REQUIRED", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Agent 消息" })).toBeDisabled();
  await expect(page.getByText("TRAEVIS Competition", { exact: true }).first()).toBeVisible();

  await page.locator(".agent-file-list > button").filter({ hasText: "src" }).click();
  await page.locator(".agent-file-list > button").filter({ hasText: "tarevis-control-center" }).click();
  await page.locator(".agent-file-list > button").filter({ hasText: "README.md" }).click();
  await expect(page.locator(".agent-file-preview")).toContainText("T.R.A.E.V.I.S. Control Center");

  await page.getByRole("button", { name: "新增项目" }).click();
  await page.getByLabel("项目名称").fill("E2E Temporary Project");
  await page.getByLabel("项目路径").fill(repositoryRoot);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("E2E Temporary Project", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "确认移除" }).click();
  await expect(page.getByText("E2E Temporary Project", { exact: true })).toHaveCount(0);

  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(tmpdir(), "tarevis-agent-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Agent 工作台" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(tmpdir(), "tarevis-agent-mobile.png"), fullPage: true });

  await page.setViewportSize({ width: 480, height: 320 });
  await expect(page.getByRole("heading", { name: "Agent 工作台" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
