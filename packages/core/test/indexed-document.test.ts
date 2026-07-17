import { describe, expect, it } from "vitest";
import {
  createIndexedDocument,
  paintPixel,
  renderRgba,
  replacePaletteEntry,
  type PaletteEntry,
} from "../src/index";

const transparent: PaletteEntry = {
  id: "transparent",
  name: "Transparent",
  rgba: [0, 0, 0, 0],
};

const ink: PaletteEntry = {
  id: "ink",
  name: "Ink",
  rgba: [32, 40, 56, 255],
};

describe("indexed documents", () => {
  it("stores palette indices instead of copied RGBA values", () => {
    const document = createIndexedDocument(2, 1, [transparent, ink]);
    paintPixel(document, 1, 0, 1);

    expect([...document.pixels]).toEqual([0, 1]);
    expect([...renderRgba(document)]).toEqual([0, 0, 0, 0, 32, 40, 56, 255]);
  });

  it("recolors every use when a linked palette entry changes", () => {
    const document = createIndexedDocument(2, 1, [transparent, ink]);
    paintPixel(document, 0, 0, 1);
    paintPixel(document, 1, 0, 1);

    const recolored = replacePaletteEntry(document, 1, {
      ...ink,
      rgba: [216, 88, 88, 255],
    });

    expect(recolored.pixels).toBe(document.pixels);
    expect([...renderRgba(recolored)]).toEqual([
      216, 88, 88, 255,
      216, 88, 88, 255,
    ]);
  });
});

