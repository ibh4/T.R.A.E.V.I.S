import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { FakeTraeBridge } from "./fake-trae-bridge";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendBaseUrl = "http://127.0.0.1:8781";
const frontendBaseUrl = "http://127.0.0.1:5181";
let backend: ChildProcess | null = null;
let fakeBridge: FakeTraeBridge | null = null;

async function waitForBackend(): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${backendBaseUrl}/api/state`);
      if (response.ok) {
        const state = await response.json() as {
          snapshot?: { services?: Array<{ serviceId: string; connection: string }> };
        };
        const trae = state.snapshot?.services?.find((service) => service.serviceId === "trae-adapter");
        if (trae?.connection === "online") return;
      }
    } catch {
      // The process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the test backend");
}

async function startBackend(): Promise<void> {
  if (!fakeBridge) throw new Error("Fake Bridge must be started before the backend");
  backend = spawn(process.execPath, ["backend/dist/server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CONTROL_CENTER_MODE: "hybrid",
      CONTROL_CENTER_LOG_LEVEL: "error",
      CONTROL_CENTER_PORT: "8781",
      CONTROL_CENTER_TRAE_ADAPTER: "communicate",
      TRAE_COMMUNICATE_URL: fakeBridge.url,
      TRAE_COMMUNICATE_TIMEOUT_MS: "1000",
      TRAE_COMMUNICATE_HEALTH_INTERVAL_MS: "1000",
    },
    stdio: "pipe",
  });
  await waitForBackend();
}

async function startFakeBridge(): Promise<void> {
  fakeBridge = new FakeTraeBridge();
  await fakeBridge.start();
}

async function stopFakeBridge(): Promise<void> {
  if (!fakeBridge) return;
  await fakeBridge.close();
  fakeBridge = null;
}

async function stopBackend(): Promise<void> {
  if (!backend) return;
  if (backend.exitCode !== null) {
    backend = null;
    return;
  }
  const processToStop = backend;
  const exited = new Promise<void>((resolve) => processToStop.once("exit", () => resolve()));
  processToStop.kill("SIGTERM");
  await exited;
  backend = null;
}

test.beforeEach(async () => {
  await startFakeBridge();
  await startBackend();
});

test.afterEach(async () => {
  await stopBackend();
  await stopFakeBridge();
});

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: "进入中控台" }).click();
  await expect(page).toHaveURL(/\/console\/overview$/);
  await expect(page.locator(".console-header__status").getByText("在线", { exact: true })).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
}

async function expectNoOverlap(page: Page, firstSelector: string, secondSelector: string): Promise<void> {
  const boxes = await page.locator(`${firstSelector}, ${secondSelector}`).evaluateAll((elements) => (
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    })
  ));
  expect(boxes).toHaveLength(2);
  const [first, second] = boxes;
  const overlapsHorizontally = first.left < second.right && second.left < first.right;
  const overlapsVertically = first.top < second.bottom && second.top < first.bottom;
  expect(overlapsHorizontally && overlapsVertically).toBe(false);
}

async function openDevices(page: Page): Promise<void> {
  await page.getByRole("button", { name: "设备管理" }).first().click();
  await expect(page.getByRole("heading", { name: "协作终端" })).toBeVisible();
}

async function openEvents(page: Page): Promise<void> {
  await page.getByRole("button", { name: "家庭事件" }).first().click();
  await expect(page.getByRole("heading", { name: "事件与确认" })).toBeVisible();
}

async function openTrae(page: Page): Promise<void> {
  await page.getByRole("button", { name: "TRAE 状态" }).first().click();
  await expect(page.getByRole("heading", { name: "认知大脑" })).toBeVisible();
}

async function openRobot(page: Page): Promise<void> {
  await page.getByRole("button", { name: "机器人控制" }).first().click();
  await expect(page.getByRole("heading", { name: "行动执行层" })).toBeVisible();
}

test("DevicesView stays consistent across heartbeat, two browsers, and refresh", async ({ page, browser }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await login(page);
  await openDevices(page);

  const totals = page.locator(".device-totals");
  await expect(totals.getByText("4 在线", { exact: true })).toBeVisible();
  await expect(totals.getByText("1 受限", { exact: true })).toBeVisible();
  await expect(totals.getByText("1 离线", { exact: true })).toBeVisible();
  await expect(page.locator(".device-card")).toHaveCount(6);

  const badgeCard = page.locator('[data-device-id="badge-esp32-01"]');
  await expect(badgeCard.getByText("MOCK", { exact: true })).toBeVisible();
  await expect(badgeCard.getByText("离线", { exact: true })).toBeVisible();
  await badgeCard.getByRole("button", { name: "查看 TRAEVIS 实体终端 配置" }).click();
  await expect(page.getByText("MOCK DEVICE SOURCE", { exact: true })).toBeVisible();
  await expect(page.locator(".detail-list div").filter({ hasText: "数据源模式" })).toContainText("MOCK");
  await page.getByRole("button", { name: "关闭设备信息" }).click();

  const secondContext = await browser.newContext({ baseURL: frontendBaseUrl });
  const secondPage = await secondContext.newPage();
  const secondPageErrors: string[] = [];
  secondPage.on("pageerror", (error) => secondPageErrors.push(error.message));
  await login(secondPage);
  await openDevices(secondPage);
  await expect(secondPage.locator('[data-device-id="badge-esp32-01"]').getByText("离线", { exact: true })).toBeVisible();

  const invalid = await fetch(`${backendBaseUrl}/api/devices/badge-esp32-01/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ metricValue: 91 }),
  });
  expect(invalid.status).toBe(400);
  await expect(page.getByRole("heading", { name: "协作终端" })).toBeVisible();

  const heartbeat = await fetch(`${backendBaseUrl}/api/devices/badge-esp32-01/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ detail: "实体终端 heartbeat 已恢复", metricValue: "90%" }),
  });
  expect(heartbeat.status).toBe(200);

  for (const currentPage of [page, secondPage]) {
    const currentTotals = currentPage.locator(".device-totals");
    await expect(currentTotals.getByText("5 在线", { exact: true })).toBeVisible();
    await expect(currentTotals.getByText("1 受限", { exact: true })).toBeVisible();
    await expect(currentTotals.getByText("0 离线", { exact: true })).toBeVisible();
    const currentBadge = currentPage.locator('[data-device-id="badge-esp32-01"]');
    await expect(currentBadge.getByText("在线", { exact: true })).toBeVisible();
    await expect(currentBadge).toContainText("实体终端 heartbeat 已恢复");
    await expect(currentBadge).toContainText("90%");
  }

  await secondPage.reload();
  await expect(secondPage.getByRole("heading", { name: "协作终端" })).toBeVisible();
  await expect(secondPage.locator('[data-device-id="badge-esp32-01"]').getByText("在线", { exact: true })).toBeVisible();
  await expect(secondPage.locator('[data-device-id="badge-esp32-01"]')).toContainText("90%");

  expect(pageErrors).toEqual([]);
  expect(secondPageErrors).toEqual([]);
  await secondContext.close();
});

test("Diagnostics and Overview use the backend aggregate while disconnect errors remain visible", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await login(page);
  await expect(page.getByText("客厅的检测到疑似跌倒姿态等待确认。", { exact: true })).toBeVisible();
  await expect(page.getByText("4 / 6 在线", { exact: true })).toBeVisible();
  await expect(page.locator('.resource-item').filter({ hasText: "ALERT PRESSURE" })).toContainText("1 CRITICAL");
  await expect(page.locator(".console-header__status")).toContainText("HYBRID ADAPTER");

  await page.getByRole("button", { name: "系统诊断" }).first().click();
  await expect(page.getByRole("heading", { name: "服务与网络" })).toBeVisible();
  await expect(page.locator(".service-list article")).toHaveCount(5);
  await expect(page.locator('[data-service-id="backend-core"]')).toContainText("在线");
  await expect(page.locator('[data-service-id="devices-module"]')).toContainText("受限");
  await expect(page.locator('[data-service-id="events-module"]')).toContainText("在线");
  await expect(page.locator('[data-service-id="trae-adapter"]')).toContainText("在线");
  await expect(page.locator('[data-service-id="robot-adapter"]')).toContainText("在线");
  await expect(page.locator(".service-list .adapter-mode-tag")).toHaveText(["MOCK", "MOCK", "MOCK", "LIVE", "MOCK"]);
  await expect(page.locator(".diagnostic-metrics > div")).toHaveCount(4);
  await expect(page.locator('[data-resource-id="vision"]')).toContainText("4.8 FPS");
  await expect(page.locator('[data-resource-id="alerts"]')).toContainText("1 CRITICAL");
  await expect(page.locator(".topology-strip")).not.toContainText("PENDING");
  await expect(page.locator(".topology-strip")).toContainText("ONLINE / MOCK");

  await page.getByRole("button", { name: "总览" }).first().click();
  await expect(page.getByRole("heading", { name: "统一状态面" })).toBeVisible();

  await stopBackend();
  const offlineNotice = page.getByTestId("connection-notice");
  await expect(offlineNotice).toContainText("后端离线");
  await expect(offlineNotice).toContainText("实时连接已断开");
  await expect(page.getByRole("heading", { name: "统一状态面" })).toBeVisible();

  await page.route("**/api/state*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ schemaVersion: "2.0", revision: 1, snapshot: {} }),
  }));
  await page.reload();
  const protocolNotice = page.getByTestId("connection-notice");
  await expect(protocolNotice).toContainText("协议错误");
  await expect(protocolNotice).toContainText("schemaVersion 1.0");
  expect(pageErrors).toEqual([]);
});

test("Overview summaries stay consistent with Devices, Events, TRAE, Robot, and Diagnostics", async ({ page }) => {
  await login(page);
  await expect(page.getByText("4 / 6 在线", { exact: true })).toBeVisible();
  await expect(page.locator(".summary-cell").filter({ hasText: "TRAE" })).toContainText("空闲");
  await expect(page.locator(".summary-cell").filter({ hasText: "ROBOT" })).toContainText("82% 电量");
  await expect(page.locator(".console-header__status")).toContainText("1 ACTIVE");

  await openDevices(page);
  await expect(page.locator(".device-totals")).toContainText("4 在线");
  await expect(page.locator(".device-totals")).toContainText("1 受限");
  await expect(page.locator(".device-totals")).toContainText("1 离线");

  const heartbeat = await fetch(`${backendBaseUrl}/api/devices/badge-esp32-01/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ metricValue: "90%" }),
  });
  expect(heartbeat.status).toBe(200);
  await expect(page.locator(".device-totals")).toContainText("5 在线");
  await page.getByRole("button", { name: "总览" }).first().click();
  await expect(page.getByText("5 / 6 在线", { exact: true })).toBeVisible();

  await openEvents(page);
  await page.getByRole("button", { name: "确认已查看" }).click();
  await page.getByRole("button", { name: "解决事件" }).click();
  await expect(page.locator(".console-header__status")).toContainText("0 ACTIVE");
  await page.getByRole("button", { name: "系统诊断" }).first().click();
  await expect(page.locator('[data-resource-id="alerts"]')).toContainText("0 ACTIVE");
  await page.getByRole("button", { name: "总览" }).first().click();
  await expect(page.locator('.resource-item').filter({ hasText: "ALERT PRESSURE" })).toContainText("0 ACTIVE");
});

test("all six backend-driven views avoid horizontal overflow at target viewports", async ({ page }) => {
  test.setTimeout(90_000);
  const views = [
    ["总览", "统一状态面"],
    ["家庭事件", "事件与确认"],
    ["设备管理", "协作终端"],
    ["TRAE 状态", "认知大脑"],
    ["机器人控制", "行动执行层"],
    ["系统诊断", "服务与网络"],
  ] as const;

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 480, height: 320 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.evaluate(() => sessionStorage.clear());
    await page.goto("/login");
    await page.getByRole("button", { name: "进入中控台" }).click();
    for (const [navigation, heading] of views) {
      await page.getByRole("button", { name: navigation }).first().click();
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  }
});

test("RobotView uses structured confirmed actions, priority stop, and two-browser sync", async ({ page, browser }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await login(page);
  await openRobot(page);
  await expect(page.locator(".robot-current-state")).toContainText("待命");
  await expect(page.getByText("MOCK ROBOT ADAPTER", { exact: true })).toBeVisible();
  await expect(page.locator(".command-bar__target")).toHaveText("TRAE");
  await expect(page.locator(".command-bar select")).toHaveCount(0);

  await page.route("**/api/robot/commands*", (route) => route.fulfill({
    status: 400,
    contentType: "application/json",
    body: JSON.stringify({ error: { code: "TEST_ERROR", message: "测试机器人动作提交失败" } }),
  }));
  await page.getByRole("button", { name: "前进", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /确认发送“前进”命令/ })).toBeVisible();
  await page.getByRole("button", { name: "确认发送" }).click();
  await expect(page.locator(".action-error")).toHaveText("测试机器人动作提交失败");
  await expect(page.getByRole("dialog", { name: /确认发送“前进”命令/ })).toBeVisible();
  await page.unroute("**/api/robot/commands*");
  await page.getByRole("button", { name: "关闭确认" }).click();

  const secondContext = await browser.newContext({ baseURL: frontendBaseUrl });
  const secondPage = await secondContext.newPage();
  const secondPageErrors: string[] = [];
  secondPage.on("pageerror", (error) => secondPageErrors.push(error.message));
  await login(secondPage);
  await openRobot(secondPage);

  await page.getByRole("button", { name: "前进", exact: true }).click();
  await page.getByRole("button", { name: "确认发送" }).click();
  const forwardText = "机器人前进 30 厘米";
  for (const currentPage of [page, secondPage]) {
    const row = currentPage.locator(".command-history article").filter({ hasText: forwardText }).first();
    await expect(row).toContainText("成功", { timeout: 4_000 });
    await expect(row).toContainText("Mock Robot 已返回动作完成回执。");
    await expect(currentPage.locator(".robot-current-state")).toContainText("待命");
  }

  await secondPage.getByRole("button", { name: /区域巡逻/ }).click();
  await secondPage.getByRole("button", { name: "确认发送" }).click();
  const patrol = secondPage.locator(".command-history article").filter({ hasText: "开始安全区域巡逻" }).first();
  await expect(patrol).toContainText(/发送中|已接收|执行中/);
  await secondPage.getByRole("button", { name: /紧急停止/ }).click();

  for (const currentPage of [page, secondPage]) {
    const interrupted = currentPage.locator(".command-history article").filter({ hasText: "开始安全区域巡逻" }).first();
    await expect(interrupted).toContainText("失败");
    await expect(interrupted).toContainText("动作已由紧急停止中断。");
    const emergency = currentPage.locator(".command-history article").filter({ hasText: "停止所有运动（急停）" }).first();
    await expect(emergency).toContainText("成功");
    await expect(emergency).toContainText("Mock Robot 已确认所有运动输出停止。");
    await expect(currentPage.locator(".robot-current-state")).toContainText("紧急停止");
  }

  expect(pageErrors).toEqual([]);
  expect(secondPageErrors).toEqual([]);
  await secondContext.close();
});

test("EventsView acknowledge and resolve stay synchronized across two browsers", async ({ page, browser }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await login(page);
  await openEvents(page);
  await expect(page.locator(".event-table-body button")).toHaveCount(1);
  await expect(page.locator(".event-state")).toHaveText("待确认");
  await expect(page.locator(".detail-list").getByText("MOCK", { exact: true })).toBeVisible();

  await page.route("**/api/events/evt_mock_fall_001/ack*", (route) => route.fulfill({
    status: 409,
    contentType: "application/json",
    body: JSON.stringify({ error: { code: "TEST_ERROR", message: "测试确认失败" } }),
  }));
  await page.getByRole("button", { name: "确认已查看" }).click();
  await expect(page.locator(".action-error")).toHaveText("测试确认失败");
  await page.unroute("**/api/events/evt_mock_fall_001/ack*");

  const secondContext = await browser.newContext({ baseURL: frontendBaseUrl });
  const secondPage = await secondContext.newPage();
  const secondPageErrors: string[] = [];
  secondPage.on("pageerror", (error) => secondPageErrors.push(error.message));
  await login(secondPage);
  await openEvents(secondPage);

  await page.getByRole("button", { name: "确认已查看" }).click();
  for (const currentPage of [page, secondPage]) {
    await expect(currentPage.locator(".event-state")).toHaveText("已确认待解决");
    await expect(currentPage.getByRole("button", { name: "事件已确认" })).toBeDisabled();
    await expect(currentPage.getByRole("button", { name: "解决事件" })).toBeEnabled();
  }

  await secondPage.getByRole("button", { name: "总览" }).first().click();
  await expect(secondPage.locator(".home-state")).toContainText("需要关注");
  await expect(secondPage.getByText("客厅的检测到疑似跌倒姿态已确认，等待解决。", { exact: true })).toBeVisible();
  await openEvents(secondPage);

  await page.route("**/api/events/evt_mock_fall_001/resolve*", (route) => route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ error: { code: "TEST_ERROR", message: "测试解决失败" } }),
  }));
  await page.getByRole("button", { name: "解决事件" }).click();
  await expect(page.locator(".action-error")).toHaveText("测试解决失败");
  await page.unroute("**/api/events/evt_mock_fall_001/resolve*");
  await page.getByRole("button", { name: "解决事件" }).click();

  for (const currentPage of [page, secondPage]) {
    await expect(currentPage.locator(".event-state")).toHaveText("已关闭");
    await expect(currentPage.locator(".console-header__status")).toContainText("0 ACTIVE");
    await currentPage.getByRole("button", { name: "总览" }).first().click();
    await expect(currentPage.locator(".home-state")).toContainText("状态正常");
    await expect(currentPage.getByText("当前没有未解决的警告或紧急家庭事件。", { exact: true })).toBeVisible();
  }

  expect(pageErrors).toEqual([]);
  expect(secondPageErrors).toEqual([]);
  await secondContext.close();
});

test("TRAE lifecycle and global command history stay synchronized across two browsers", async ({ page, browser }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await login(page);
  await openTrae(page);
  await expect(page.locator(".trae-state")).toContainText("空闲");
  await expect(page.getByText("LIVE TRAE ADAPTER", { exact: true })).toBeVisible();
  await expect(page.locator(".command-bar select")).toHaveCount(0);
  await expect(page.locator(".command-bar__target")).toHaveText("TRAE");

  const textarea = page.getByPlaceholder("描述你希望 TRAE 分析或推进的任务...");
  await page.route("**/api/trae/commands*", (route) => route.fulfill({
    status: 400,
    contentType: "application/json",
    body: JSON.stringify({ error: { code: "TEST_ERROR", message: "测试 TRAE 提交失败" } }),
  }));
  await textarea.fill("失败后保留的任务文本");
  await page.getByRole("button", { name: "提交给 TRAE" }).click();
  await expect(page.locator(".action-error")).toHaveText("测试 TRAE 提交失败");
  await expect(textarea).toHaveValue("失败后保留的任务文本");
  await page.unroute("**/api/trae/commands*");

  const secondContext = await browser.newContext({ baseURL: frontendBaseUrl });
  const secondPage = await secondContext.newPage();
  const secondPageErrors: string[] = [];
  secondPage.on("pageerror", (error) => secondPageErrors.push(error.message));
  await login(secondPage);
  await openTrae(secondPage);

  const viewCommand = "整理当前家庭事件并生成两步建议";
  await textarea.fill(viewCommand);
  await page.getByRole("button", { name: "提交给 TRAE" }).click();
  const firstRow = page.locator(".command-history article").filter({ hasText: viewCommand }).first();
  await expect(firstRow).toContainText(/正在投递|已读取回复/);
  for (const currentPage of [page, secondPage]) {
    const row = currentPage.locator(".command-history article").filter({ hasText: viewCommand }).first();
    await expect(row).toContainText("已读取回复", { timeout: 4_000 });
    await expect(row).toContainText("Fake TRAE 已返回可读回复。");
    await expect(currentPage.locator(".trae-state")).toContainText("已读取回复");
  }

  const globalCommand = "从全局命令栏生成家庭风险摘要";
  await secondPage.getByLabel("TRAE 命令").fill(globalCommand);
  await secondPage.getByRole("button", { name: "发送命令" }).click();
  await expect(secondPage.getByLabel("TRAE 命令")).toHaveValue("");
  for (const currentPage of [page, secondPage]) {
    const row = currentPage.locator(".command-history article").filter({ hasText: globalCommand }).first();
    await expect(row).toContainText("已读取回复", { timeout: 4_000 });
  }

  expect(pageErrors).toEqual([]);
  expect(secondPageErrors).toEqual([]);
  await secondContext.close();
});

test("TRAE visual acceptance covers target layouts, boundary text, and connection states", async ({ page }) => {
  test.setTimeout(45_000);
  await login(page);
  await openTrae(page);
  const onlineColor = await page.locator(".trae-state--idle").evaluate((element) => getComputedStyle(element).color);

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expectNoHorizontalOverflow(page);
    await expectNoOverlap(page, ".trae-task-panel", ".trae-command-panel");
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const textarea = page.getByPlaceholder("描述你希望 TRAE 分析或推进的任务...");
  const before = await textarea.boundingBox();
  await textarea.fill("任".repeat(2_000));
  const after = await textarea.boundingBox();
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(after!.width).toBeCloseTo(before!.width, 0);
  expect(after!.height).toBeCloseTo(before!.height, 0);
  await expectNoHorizontalOverflow(page);

  await textarea.fill("[fake:long-error] 验证最长 Bridge 错误不会撑破命令记录");
  await page.getByRole("button", { name: "提交给 TRAE" }).click();
  const failedRow = page.locator(".command-history article").filter({ hasText: "[fake:long-error]" }).first();
  await expect(failedRow).toContainText("失败", { timeout: 5_000 });
  await expect(failedRow.locator("small")).toContainText("Bridge returned HTTP 503");
  const recordDimensions = await failedRow.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(recordDimensions.scrollWidth).toBeLessThanOrEqual(recordDimensions.clientWidth);
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  expect(fakeBridge).not.toBeNull();
  fakeBridge!.readiness = "degraded";
  const degradedPanel = page.locator(".trae-unavailable-panel--degraded");
  await expect(degradedPanel).toContainText("TRAE Bridge 当前受限", { timeout: 5_000 });
  const degradedColor = await degradedPanel.evaluate((element) => getComputedStyle(element).color);

  fakeBridge!.readiness = "offline";
  const offlinePanel = page.locator(".trae-unavailable-panel--offline");
  await expect(offlinePanel).toContainText("TRAE Bridge / Adapter 不可用", { timeout: 5_000 });
  const offlineColor = await offlinePanel.evaluate((element) => getComputedStyle(element).color);
  expect(new Set([onlineColor, degradedColor, offlineColor]).size).toBe(3);

  fakeBridge!.readiness = "online";
  await expect(page.locator(".trae-unavailable-panel")).toHaveCount(0, { timeout: 5_000 });
  await expect(textarea).toBeEnabled();

  await page.setViewportSize({ width: 480, height: 320 });
  await expectNoHorizontalOverflow(page);
});

test("TRAE entries stay disabled with preserved input during backend disconnect and recover together", async ({ page }) => {
  await login(page);
  await openTrae(page);

  const traeTextarea = page.getByPlaceholder("描述你希望 TRAE 分析或推进的任务...");
  const globalInput = page.getByLabel("TRAE 命令");
  await traeTextarea.fill("断线后仍需保留的 TRAE 任务");
  await globalInput.fill("断线后仍需保留的全局命令");

  await stopBackend();
  await expect(page.getByTestId("connection-notice")).toContainText("实时连接已断开", { timeout: 5_000 });
  await expect(traeTextarea).toBeDisabled();
  await expect(page.locator(".trae-command-form button[type=submit]")).toBeDisabled();
  await expect(globalInput).toBeDisabled();
  await expect(page.getByRole("button", { name: "发送命令" })).toBeDisabled();
  await expect(traeTextarea).toHaveValue("断线后仍需保留的 TRAE 任务");
  await expect(globalInput).toHaveValue("断线后仍需保留的全局命令");
  await expect(page.locator(".trae-unavailable-panel")).toContainText("TRAE Bridge / Adapter 不可用");

  await startBackend();
  await expect(page.getByTestId("connection-notice")).toHaveCount(0, { timeout: 10_000 });
  await expect(traeTextarea).toBeEnabled();
  await expect(globalInput).toBeEnabled();
});

test("disconnect keeps the last snapshot degraded and reconnect accepts a restarted backend", async ({ page }) => {
  await login(page);
  await openEvents(page);
  await page.getByRole("button", { name: "确认已查看" }).click();
  await expect(page.locator(".event-state")).toHaveText("已确认待解决");

  await stopBackend();
  await expect(page.getByTestId("connection-notice")).toContainText("实时连接已断开", { timeout: 5_000 });
  await expect(page.locator(".console-header__status .connection-state")).toHaveText("受限");
  await expect(page.locator(".event-state")).toHaveText("已确认待解决");

  await startBackend();
  await expect(page.getByTestId("connection-notice")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator(".console-header__status .connection-state")).toHaveText("在线");
  await expect(page.locator(".event-state")).toHaveText("待确认");
});

test("an older REST response cannot overwrite a newer websocket snapshot", async ({ page }) => {
  await login(page);
  await openTrae(page);

  let markCaptured: (() => void) | undefined;
  const captured = new Promise<void>((resolve) => {
    markCaptured = resolve;
  });
  let releaseResponse: (() => void) | undefined;
  const release = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route("**/api/state*", async (route) => {
    const response = await route.fetch();
    markCaptured?.();
    await release;
    await route.fulfill({ response });
  });

  await page.getByPlaceholder("描述你希望 TRAE 分析或推进的任务...").fill("REST revision race");
  await page.getByRole("button", { name: "提交给 TRAE" }).click();
  await captured;
  const heartbeat = await fetch(`${backendBaseUrl}/api/devices/badge-esp32-01/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ metricValue: "77%" }),
  });
  expect(heartbeat.ok).toBe(true);
  await openDevices(page);
  const badge = page.locator('[data-device-id="badge-esp32-01"]');
  await expect(badge).toContainText("77%");

  releaseResponse?.();
  await page.waitForTimeout(200);
  await expect(badge).toContainText("77%");
  await page.unroute("**/api/state*");
});

test("demo reset is visible, repeatable, and synchronized across two browsers", async ({ page, browser }) => {
  await login(page);
  await openEvents(page);
  const secondContext = await browser.newContext({ baseURL: frontendBaseUrl });
  const secondPage = await secondContext.newPage();
  await login(secondPage);
  await openEvents(secondPage);

  await page.getByRole("button", { name: "确认已查看" }).click();
  for (const currentPage of [page, secondPage]) {
    await expect(currentPage.locator(".event-state")).toHaveText("已确认待解决");
  }

  await page.getByRole("button", { name: "重置演示状态" }).click();
  await expect(page.getByRole("status")).toContainText("演示状态已重置");
  for (const currentPage of [page, secondPage]) {
    await expect(currentPage.locator(".event-state")).toHaveText("待确认");
  }

  await secondPage.getByRole("button", { name: "重置演示状态" }).click();
  await expect(secondPage.getByRole("status")).toContainText("演示状态已重置");
  for (const currentPage of [page, secondPage]) {
    await expect(currentPage.locator(".event-state")).toHaveText("待确认");
  }
  await secondContext.close();
});
