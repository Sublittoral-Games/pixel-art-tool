// SPDX-License-Identifier: MPL-2.0

import { expect, test, type Page } from "@playwright/test";

async function openEditor(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Pencil" })).toBeEnabled();
}

test("draws one committed stroke and supports undo and redo", async ({ page }) => {
  await openEditor(page);

  const canvas = page.getByTestId("pixel-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) {
    throw new Error("Pixel canvas did not have layout bounds.");
  }

  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await page.mouse.move(center.x - 20, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 40, center.y, { steps: 5 });
  await page.mouse.up();

  await expect(page.getByTestId("painted-count")).not.toContainText("· 0 painted");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("painted-count")).toContainText("· 0 painted");
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByTestId("painted-count")).not.toContainText("· 0 painted");
});

test("wheel zoom changes the view without changing the document", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Wheel navigation runs in desktop Chromium.");
  await openEditor(page);

  const canvas = page.getByTestId("pixel-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) {
    throw new Error("Pixel canvas did not have layout bounds.");
  }
  const fit = page.getByRole("button", { name: "Fit canvas" });
  const initialLabel = await fit.textContent();

  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, -160);

  await expect.poll(() => fit.textContent()).not.toBe(initialLabel);
  await expect(page.getByTestId("painted-count")).toContainText("· 0 painted");
});

test("pen hover previews its target pixel without changing the document", async ({ page }) => {
  await openEditor(page);

  const canvas = page.getByTestId("pixel-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) {
    throw new Error("Pixel canvas did not have layout bounds.");
  }
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const canvasBeforeHover = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());

  await canvas.dispatchEvent("pointermove", {
    pointerId: 10,
    pointerType: "pen",
    isPrimary: true,
    button: -1,
    buttons: 0,
    clientX: center.x,
    clientY: center.y,
  });

  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).not.toBe(canvasBeforeHover);
  await expect(page.getByTestId("painted-count")).toContainText("· 0 painted");

  await canvas.dispatchEvent("pointerleave", {
    pointerId: 10,
    pointerType: "pen",
    isPrimary: true,
    button: -1,
    buttons: 0,
    clientX: bounds.x + bounds.width,
    clientY: bounds.y + bounds.height,
  });

  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(canvasBeforeHover);
});

test("a second touch cancels tentative drawing and starts pinch navigation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "iphone-15-pro-max-webkit", "Touch contract runs in mobile WebKit.");
  await openEditor(page);

  const canvas = page.getByTestId("pixel-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) {
    throw new Error("Pixel canvas did not have layout bounds.");
  }
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const fit = page.getByRole("button", { name: "Fit canvas" });
  const initialLabel = await fit.textContent();

  await canvas.dispatchEvent("pointerdown", {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: center.x - 20,
    clientY: center.y,
  });
  await canvas.dispatchEvent("pointermove", {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    buttons: 1,
    clientX: center.x,
    clientY: center.y,
  });
  await canvas.dispatchEvent("pointerdown", {
    pointerId: 2,
    pointerType: "touch",
    isPrimary: false,
    button: 0,
    clientX: center.x + 20,
    clientY: center.y,
  });
  await canvas.dispatchEvent("pointermove", {
    pointerId: 2,
    pointerType: "touch",
    isPrimary: false,
    buttons: 1,
    clientX: center.x + 100,
    clientY: center.y,
  });
  await canvas.dispatchEvent("pointerup", {
    pointerId: 2,
    pointerType: "touch",
    isPrimary: false,
    button: 0,
    clientX: center.x + 100,
    clientY: center.y,
  });
  await canvas.dispatchEvent("pointerup", {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: center.x,
    clientY: center.y,
  });

  await expect(page.getByTestId("painted-count")).toContainText("· 0 painted");
  await expect.poll(() => fit.textContent()).not.toBe(initialLabel);
});

test("the phone shell keeps primary controls visible without horizontal overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "iphone-15-pro-max-webkit", "Phone layout runs in mobile WebKit.");
  await openEditor(page);

  for (const name of ["Pencil", "Eraser", "Undo", "Redo"]) {
    await expect(page.getByRole("button", { name })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(430);
});

test("checkpoints and recovers the current document through an offline reload", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "The Playwright WebKit build does not expose OPFS.");
  await openEditor(page);

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
    await page.reload();
    await expect(page.getByRole("button", { name: "Pencil" })).toBeEnabled();
  }

  const canvas = page.getByTestId("pixel-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) {
    throw new Error("Pixel canvas did not have layout bounds.");
  }
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(page.getByTestId("painted-count")).not.toContainText("· 0 painted");
  await expect(page.getByTestId("persistence-status")).toContainText("Saved locally");

  await page.getByText("Project", { exact: true }).click();
  await page.getByRole("button", { name: "Save checkpoint" }).click();
  await expect(page.getByTestId("persistence-status")).toContainText("Checkpoint ready");

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId("painted-count")).not.toContainText("· 0 painted");
  await expect(page.getByTestId("persistence-status")).toContainText("Recovered locally");
  await context.setOffline(false);
});

test("imports and exports a validated portable indexed document", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Portable project flow runs once in desktop Chromium.");
  await openEditor(page);

  await page.getByLabel("Choose portable project").setInputFiles({
    name: "tiny.pixelart.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({
      schemaVersion: 1,
      width: 2,
      height: 2,
      transparentIndex: 0,
      palette: [
        { id: "transparent", name: "Transparent", rgba: [0, 0, 0, 0] },
        { id: "ink", name: "Ink", rgba: [20, 30, 40, 255] },
      ],
      pixels: [1, 0, 0, 1],
    })),
  });

  await expect(page.getByTestId("painted-count")).toContainText("2 × 2 · 2 painted");
  await expect(page.getByTestId("persistence-status")).toContainText("checkpoint ready");
  await page.getByText("Project", { exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export project" }).click();
  await expect((await downloadPromise).suggestedFilename()).toBe("untitled-sprite.pixelart.json");
});

test("replays the journal and exports the animated GIF fallback", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Timelapse fallback runs once in desktop Chromium.");
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, "VideoEncoder", { configurable: true, value: undefined });
  });
  await openEditor(page);

  const canvas = page.getByTestId("pixel-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) {
    throw new Error("Pixel canvas did not have layout bounds.");
  }
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(page.getByTestId("persistence-status")).toContainText("Saved locally");

  await page.getByText("Project", { exact: true }).click();
  await page.getByRole("button", { name: "Replay history" }).click();
  await expect(page.getByTestId("persistence-status")).toContainText("Replay matched");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export timelapse" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("untitled-timelapse.gif");
  await expect(page.getByTestId("media-status")).toContainText("animated GIF fallback");
});

test("exports muxed AVC/MP4 when the browser reports encoder support", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "MP4 export runs once in desktop Chromium.");
  await openEditor(page);
  const mediaStatus = page.getByTestId("media-status");
  await expect(mediaStatus).not.toContainText("Checking");
  test.skip(!await mediaStatus.textContent().then((status) => status?.includes("AVC/MP4 ready") ?? false),
    "This browser does not expose an AVC encoder.");

  const canvas = page.getByTestId("pixel-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) {
    throw new Error("Pixel canvas did not have layout bounds.");
  }
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.getByText("Project", { exact: true }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export timelapse" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("untitled-timelapse.mp4");
  await expect(mediaStatus).toContainText("AVC/MP4 through WebCodecs");
});
