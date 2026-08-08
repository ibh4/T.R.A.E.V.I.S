import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "进入中控台" }).click();
  await expect(page).toHaveURL(/\/console\/overview$/);
  await expect(page.getByRole("heading", { name: "设备状态" })).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
}

async function expectCanvasNotBlank(page: Page) {
  const stats = await page.getByTestId("hero-status-field").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    if (!context) return { height: canvas.height, paintedSamples: 0, width: canvas.width };
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let paintedSamples = 0;
    for (let index = 3; index < pixels.length; index += 64) {
      if (pixels[index] > 0) paintedSamples += 1;
    }
    return { height: canvas.height, paintedSamples, width: canvas.width };
  });

  expect(stats.width).toBeGreaterThan(0);
  expect(stats.height).toBeGreaterThan(0);
  expect(stats.paintedSamples).toBeGreaterThan(100);
}

test("robot surfaces use the exact unframed TRAE brand mark", async ({ page }) => {
  await login(page);

  const overviewMark = page.getByTestId("overview-brand-mark");
  await expect(overviewMark).toBeVisible();
  await expect(overviewMark).toHaveAttribute("src", /trae-color|data:image\/svg/);
  const overviewFrame = await overviewMark.locator("..").evaluate((element) => {
    const style = window.getComputedStyle(element);
    return { backgroundColor: style.backgroundColor, borderWidth: style.borderWidth };
  });
  expect(overviewFrame).toEqual({ backgroundColor: "rgba(0, 0, 0, 0)", borderWidth: "0px" });

  await expect(page.locator(".summary-cell").filter({ hasText: "ROBOT" }).locator("img[data-brand-mark='true']")).toBeVisible();
  await expect(page.getByRole("button", { name: "机器人控制" }).first().locator("img[data-brand-mark='true']")).toBeVisible();

  await page.getByRole("button", { name: "机器人控制" }).first().click();
  await expect(page.locator(".robot-avatar__core img[data-brand-mark='true']")).toBeVisible();
});

test("landing page uses the exact TRAE logo asset and opens mock login", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));

  await page.goto("/");
  await expect(page).toHaveTitle(/T\.R\.A\.E\.V\.I\.S/);
  await expect(page.getByRole("heading", { name: "T.R.A.E.V.I.S." })).toBeVisible();
  await expect(page.getByTestId("hero-status-field")).toBeVisible();
  await expect(page.locator(".hero__media")).toHaveCount(0);
  await expectCanvasNotBlank(page);
  const logoSource = await page.getByAltText("TRAE").first().getAttribute("src");
  expect(logoSource).toMatch(/trae-color|data:image\/svg/);
  await page.getByRole("link", { name: /登录中控台/ }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "连接你的 T.R.A.E.V.I.S." })).toBeVisible();
  expect(errors).toEqual([]);
});

test("landing status field remains painted and contained on desktop and mobile", async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "T.R.A.E.V.I.S." })).toBeVisible();
    await expect(page.getByRole("link", { name: /进入我的中控台/ })).toBeVisible();
    await expectCanvasNotBlank(page);
    await expectNoHorizontalOverflow(page);
  }
});

test("event acknowledgement keeps unresolved risk visible in the authoritative mock snapshot", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "家庭事件" }).first().click();
  await expect(page.getByRole("heading", { name: "事件与确认" })).toBeVisible();
  await page.getByRole("button", { name: /检测到疑似跌倒姿态/ }).click();
  await page.getByRole("button", { name: "确认已查看" }).click();
  await expect(page.getByRole("button", { name: "事件已确认" })).toBeDisabled();
  await page.getByRole("button", { name: "总览" }).first().click();
  await expect(page.getByText("客厅的检测到疑似跌倒姿态已确认，等待解决。", { exact: true })).toBeVisible();
  await expect(page.locator(".home-state")).toContainText("需要关注");
});

test("desktop event typography stays readable for judge captures", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await login(page);
  await page.getByRole("button", { name: "家庭事件" }).first().click();

  await expect(page.locator(".event-table--header")).toHaveCSS("font-size", "11px");
  await expect(page.locator(".event-table--header")).toHaveCSS("color", "rgb(188, 199, 196)");
  await expect(page.locator(".event-title-cell strong").first()).toHaveCSS("font-size", "12px");
  await expect(page.locator(".event-detail-panel > p")).toHaveCSS("font-size", "13px");
  await expect(page.locator(".detail-list dd").first()).toHaveCSS("font-size", "10px");
  await expectNoHorizontalOverflow(page);
});

test("TRAE command exposes requested through succeeded lifecycle", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "TRAE 状态" }).first().click();
  const command = "整理当前家庭事件并生成两步建议";
  await page.getByPlaceholder("描述你希望 TRAE 分析或推进的任务...").fill(command);
  await page.getByRole("button", { name: "提交给 TRAE" }).click();
  const historyRow = page.locator(".command-history article").filter({ hasText: command }).first();
  await expect(historyRow).toContainText("已请求");
  await expect(historyRow).toContainText("已读取回复", { timeout: 4_000 });
});

test("robot movement requires confirmation before entering the queue", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "机器人控制" }).first().click();
  await page.getByRole("button", { name: "前进", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /确认发送“前进”命令/ })).toBeVisible();
  await expect(page.locator(".command-history article").filter({ hasText: "机器人前进 30 厘米" })).toHaveCount(0);
  await page.getByRole("button", { name: "确认发送" }).click();
  const actionLog = page.locator(".command-history article").filter({ hasText: "机器人前进 30 厘米" }).first();
  await expect(actionLog).toBeVisible();
  await expect(actionLog).toContainText("成功", { timeout: 3_000 });
  await expect(actionLog).toContainText("Mock adapter 已返回成功回执");
  await expect(page.getByText("MOCK ROBOT ADAPTER", { exact: true })).toBeVisible();
});

test("browser mock emergency stop interrupts a confirmed robot action", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "机器人控制" }).first().click();
  await page.getByRole("button", { name: /区域巡逻/ }).click();
  await page.getByRole("button", { name: "确认发送" }).click();
  const patrol = page.locator(".command-history article").filter({ hasText: "开始安全区域巡逻" }).first();
  await expect(patrol).toContainText("发送中");
  await page.getByRole("button", { name: /紧急停止/ }).click();
  await expect(patrol).toContainText("失败");
  await expect(patrol).toContainText("动作已由紧急停止中断");
  const emergency = page.locator(".command-history article").filter({ hasText: "停止所有运动（急停）" }).first();
  await expect(emergency).toContainText("成功");
  await expect(page.locator(".robot-current-state")).toContainText("紧急停止");
});

test("all six console views render and the device drawer exposes adapter mode", async ({ page }) => {
  await login(page);
  const views = [
    ["总览", "设备状态"],
    ["家庭事件", "事件与确认"],
    ["设备管理", "协作终端"],
    ["TRAE 状态", "认知大脑"],
    ["机器人控制", "行动执行层"],
    ["系统诊断", "服务与网络"],
  ] as const;

  for (const [navigation, heading] of views) {
    await page.getByRole("button", { name: navigation }).first().click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }

  await page.getByRole("button", { name: "设备管理" }).first().click();
  await page.getByRole("button", { name: "查看 家庭感知节点 01 配置" }).click();
  await expect(page.getByText("MOCK DEVICE SOURCE")).toBeVisible();
  await page.getByRole("button", { name: "关闭设备信息" }).click();

  await page.getByRole("button", { name: "查看 OV5647 Camera 配置" }).click();
  await expect(page.getByRole("region", { name: "OV5647 Camera 实时画面" })).toBeVisible();
  await expect(page.locator(".camera-preview__status")).toHaveText("未配置");
  await expect(page.getByRole("button", { name: "打开画面" })).toBeDisabled();
  await page.getByRole("button", { name: "关闭设备信息" }).click();
});

test("desktop, mobile, and 480x320 console surfaces do not overflow horizontally", async ({ page }) => {
  test.setTimeout(90_000);
  const views = [
    ["总览", "设备状态"],
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
