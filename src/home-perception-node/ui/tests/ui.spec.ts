import { expect, test } from "@playwright/test";

test("renders every 480x320 page without overflow", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/?profile=pi&standalone=1");
  await expect(page).toHaveTitle("TAREVIS Home Node");
  await expect(page.locator(".guard-copy strong")).toHaveText("家庭守护中");

  for (const id of ["guard", "vision", "audio", "events", "device"]) {
    await page.locator(`[data-nav="${id}"]`).click();
    await expect(page.locator(`[data-nav="${id}"]`)).toHaveAttribute("aria-pressed", "true");
    const dimensions = await page.locator(".device-shell").evaluate((element) => ({
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight,
    }));
    expect(dimensions).toEqual({ clientWidth: 480, clientHeight: 320, scrollWidth: 480, scrollHeight: 320 });
  }

  expect(errors).toEqual([]);
});

test("camera and audio controls update real local state", async ({ page }) => {
  await page.goto("/?profile=pi&page=vision&standalone=1");
  await page.locator('[data-action="toggle-camera"]').click();
  await expect(page.locator(".vision-status strong")).toHaveText("视觉感知中");
  await expect(page.locator(".metric").filter({ hasText: "帧率" })).toContainText("5.0 FPS");

  await page.locator('[data-nav="audio"]').click();
  await page.locator('[data-action="toggle-audio"]').click();
  await expect(page.locator(".audio-status-heading strong")).toHaveText("声音感知中");
  await expect(page.locator(".audio-word")).toHaveText("LISTEN");
});

test("device settings scan, test, and save stay inside the 480x320 surface", async ({ page }) => {
  await page.goto("/?profile=pi&page=device&standalone=1");
  await page.locator('[data-action="open-media-settings"]').click();

  await expect(page.locator(".media-settings-panel")).toBeVisible();
  await expect(page.locator('[data-media-device="camera"]')).toHaveValue("demo-camera-0");
  await expect(page.locator('[data-media-device="microphone"]')).toHaveValue("demo-microphone-0");

  await page.locator('[data-action="test-camera"]').click();
  await expect(page.locator(".notice-bar")).toContainText("模拟摄像头测试通过");
  await page.locator('[data-action="save-media"]').click();
  await expect(page.locator(".notice-bar")).toContainText("模拟设备配置已保存");

  const dimensions = await page.locator(".device-shell").evaluate((element) => ({
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
    scrollWidth: element.scrollWidth,
    scrollHeight: element.scrollHeight,
  }));
  expect(dimensions).toEqual({ clientWidth: 480, clientHeight: 320, scrollWidth: 480, scrollHeight: 320 });
});

test("uses the original TraePal geometry and switches expression groups", async ({ page }) => {
  await page.goto("/?profile=pi&standalone=1");
  await expect(page.locator(".avatar-body")).toHaveAttribute("d", "M24 20.541H3.428v-3.426H0V3.4h24Z");
  await expect(page.locator(".avatar-idle-eyes")).toBeVisible();
  await expect(page.locator(".avatar-alert-eyes")).toBeHidden();

  await page.locator('[data-action="toggle-demo"]').click();
  await page.locator('[data-demo="help"]').click();
  await page.locator('[data-nav="guard"]').click();
  await expect(page.locator(".trae-avatar")).toHaveClass(/mood-alert/);
  await expect(page.locator(".avatar-idle-eyes")).toBeHidden();
  await expect(page.locator(".avatar-alert-eyes")).toBeVisible();
});

test("guard HUD exposes dual continuous code streams and layered motion", async ({ page }) => {
  await page.goto("/?profile=pi&standalone=1");
  await expect(page.locator(".code-waterfall")).toHaveCount(2);
  await expect(page.locator(".code-track")).toHaveCount(4);
  await expect(page.locator(".orbit")).toHaveCount(3);
  await expect(page.locator(".radar-sweep")).toHaveCount(1);
  await expect(page.locator(".hud-scan")).toHaveCount(1);

  const animation = await page.locator(".code-reel").first().evaluate((element) => ({
    name: getComputedStyle(element).animationName,
    timing: getComputedStyle(element).animationTimingFunction,
  }));
  expect(animation.name).toBe("code-cascade");
  expect(animation.timing).toContain("steps");
});

test("centers the guard avatar and vision orbit on their HUD anchors", async ({ page }) => {
  await page.goto("/?profile=pi&standalone=1");

  const guardCenters = await page.locator(".avatar-stage").evaluate((stage) => {
    const avatar = stage.querySelector<HTMLElement>(":scope > .trae-avatar")!.getBoundingClientRect();
    const square = stage.querySelector<HTMLElement>(".hud-square")!.getBoundingClientRect();
    return {
      avatarX: avatar.left + avatar.width / 2,
      avatarY: avatar.top + avatar.height / 2,
      squareX: square.left + square.width / 2,
      squareY: square.top + square.height / 2,
    };
  });
  expect(Math.abs(guardCenters.avatarX - guardCenters.squareX)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(guardCenters.avatarY - guardCenters.squareY)).toBeLessThanOrEqual(0.5);

  await page.locator('[data-nav="vision"]').click();
  const visionCenters = await page.locator(".sensor-circle").evaluate((sensor) => {
    const circle = sensor.getBoundingClientRect();
    const ticks = sensor.querySelector<HTMLElement>(".sensor-ticks")!.getBoundingClientRect();
    return {
      circleX: circle.left + circle.width / 2,
      circleY: circle.top + circle.height / 2,
      ticksX: ticks.left + ticks.width / 2,
      ticksY: ticks.top + ticks.height / 2,
      animationName: getComputedStyle(sensor.querySelector<HTMLElement>(".sensor-ticks")!).animationName,
    };
  });
  expect(Math.abs(visionCenters.circleX - visionCenters.ticksX)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(visionCenters.circleY - visionCenters.ticksY)).toBeLessThanOrEqual(0.5);
  expect(visionCenters.animationName).toBe("sensor-orbit-spin");
});

test("keeps the confirmed vision layout with the preview button at bottom right", async ({ page }) => {
  await page.goto("/?profile=pi&page=vision&standalone=1");

  const layout = await page.locator(".vision-grid").evaluate(() => {
    const preview = document.querySelector<HTMLElement>(".camera-window")!;
    const aside = document.querySelector<HTMLElement>(".vision-core-aside")!;
    const button = aside.querySelector<HTMLElement>('[data-action="toggle-camera"]')!;
    const previewBox = preview.getBoundingClientRect();
    const sensorBox = document.querySelector<HTMLElement>(".sensor-circle")!.getBoundingClientRect();
    const asideBox = aside.getBoundingClientRect();
    const buttonBox = button.getBoundingClientRect();
    return {
      width: previewBox.width,
      height: previewBox.height,
      sensorIsRightOfPreview: sensorBox.left >= previewBox.right,
      buttonIsRightOfPreview: buttonBox.left >= previewBox.right,
      buttonNearAsideBottom: asideBox.bottom - buttonBox.bottom,
      buttonWidth: buttonBox.width,
      buttonHeight: buttonBox.height,
    };
  });

  expect(layout.width).toBeGreaterThanOrEqual(290);
  expect(layout.width).toBeGreaterThan(layout.height);
  expect(layout.sensorIsRightOfPreview).toBe(true);
  expect(layout.buttonIsRightOfPreview).toBe(true);
  expect(layout.buttonNearAsideBottom).toBeLessThanOrEqual(10);
  expect(layout.buttonWidth).toBeGreaterThanOrEqual(100);
  expect(layout.buttonHeight).toBeGreaterThanOrEqual(28);
});

test("sensor pages expose continuous motion with showcase and Pi cadence profiles", async ({ page }) => {
  await page.goto("/?profile=pi&page=vision&standalone=1");
  await expect(page.locator("html")).toHaveClass(/pi-profile/);

  const visionMotion = await page.locator(".sensor-sweep").evaluate((element) => ({
    name: getComputedStyle(element).animationName,
    timing: getComputedStyle(element).animationTimingFunction,
  }));
  expect(visionMotion.name).toBe("sensor-sweep");
  expect(visionMotion.timing).toContain("steps");
  await expect(page.locator(".camera-scanline")).toHaveCount(1);
  const sweepBefore = await page.locator(".sensor-sweep").evaluate((element) => getComputedStyle(element).transform);
  await page.waitForTimeout(300);
  const sweepAfter = await page.locator(".sensor-sweep").evaluate((element) => getComputedStyle(element).transform);
  expect(sweepAfter).not.toBe(sweepBefore);

  await page.locator('[data-nav="audio"]').click();
  await expect(page.locator(".wave-bars span").first()).toHaveCSS("animation-name", "wave-idle");
  await page.locator('[data-action="toggle-audio"]').click();
  await expect(page.locator(".wave-bars span").first()).toHaveCSS("animation-name", "wave-live");
  await expect(page.locator(".ticker-reel")).toHaveCSS("animation-name", "ticker-scroll");
  const waveBefore = await page.locator(".wave-bars span").first().evaluate((element) => getComputedStyle(element).transform);
  await page.waitForTimeout(160);
  const waveAfter = await page.locator(".wave-bars span").first().evaluate((element) => getComputedStyle(element).transform);
  expect(waveAfter).not.toBe(waveBefore);

  await page.locator('[data-nav="events"]').click();
  const eventScan = await page.locator(".event-detail").evaluate(
    (element) => getComputedStyle(element, "::before").animationName,
  );
  expect(eventScan).toBe("event-detail-scan");
  await expect(page.locator(".event-symbol")).toHaveCSS("animation-name", "event-heartbeat");

  await page.locator('[data-nav="device"]').click();
  await expect(page.locator(".device-bars span").first()).toHaveCSS("animation-name", "device-meter");

  await page.goto("/?profile=pi&motion=showcase&standalone=1");
  await expect(page.locator("html")).toHaveClass(/showcase-profile/);
  await expect(page.locator("html")).not.toHaveClass(/pi-profile/);
});

test("high priority mock event takes over and returns after acknowledgement", async ({ page }) => {
  await page.goto("/?profile=pi&page=vision&standalone=1");
  await page.locator('[data-action="toggle-demo"]').click();
  await page.locator('[data-demo="help"]').click();

  await expect(page.locator(".device-shell")).toHaveClass(/severity-critical/);
  await expect(page.locator('[data-nav="events"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".event-detail-copy strong")).toHaveText("检测到求助短语");
  await expect(page.locator(".nav-count")).toHaveText("1");

  await page.locator('[data-action="resolve-event"]').click();
  await expect(page.locator(".device-shell")).toHaveClass(/severity-resolved/);
  await expect(page.locator(".resolve-command")).toContainText("已处理");

  await expect(page.locator('[data-nav="vision"]')).toHaveAttribute("aria-pressed", "true", { timeout: 2_500 });
  await expect(page.locator(".device-shell")).toHaveClass(/severity-normal/);
});

test("informational motion updates metrics without page takeover", async ({ page }) => {
  await page.goto("/?profile=pi&page=vision&standalone=1");
  await page.locator('[data-action="toggle-demo"]').click();
  await page.locator('[data-demo="motion"]').click();

  await expect(page.locator('[data-nav="vision"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".metric").filter({ hasText: "运动" })).toContainText("8%");
  await expect(page.locator(".nav-count")).toHaveText("1");
});
