// SPDX-License-Identifier: MPL-2.0

import { expect, test } from "@playwright/test";

test("draws one committed stroke and supports undo and redo", async ({ page }) => {
  await page.goto("/");

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
  await page.goto("/");

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
  await page.goto("/");

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
  await page.goto("/");

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
  await page.goto("/");

  for (const name of ["Pencil", "Eraser", "Undo", "Redo"]) {
    await expect(page.getByRole("button", { name })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(430);
});
