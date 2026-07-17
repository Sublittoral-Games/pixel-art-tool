// SPDX-License-Identifier: MPL-2.0

import { expect, test } from "@playwright/test";

test("loads the foundation and updates a linked palette color", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Pixel Art Tool" })).toBeVisible();
  await expect(page.getByText("Foundation initialized")).toBeVisible();

  const swatch = page.locator(".swatch");
  const originalColor = await swatch.evaluate((element) => getComputedStyle(element).backgroundColor);

  await page.getByRole("button", { name: "Test linked palette color" }).click();

  await expect
    .poll(() => swatch.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe(originalColor);
});

