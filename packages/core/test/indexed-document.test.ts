// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";
import {
  applyPixelPatch,
  createPixelPatch,
  createIndexedDocument,
  paintPixel,
  PixelHistory,
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

  it("resolves repeated writes into a deterministic patch", () => {
    const document = createIndexedDocument(3, 2, [transparent, ink]);
    const patch = createPixelPatch(document, [
      { x: 2, y: 1, paletteIndex: 1 },
      { x: 0, y: 0, paletteIndex: 1 },
      { x: 2, y: 1, paletteIndex: 0 },
      { x: 2, y: 1, paletteIndex: 1 },
    ]);

    expect(patch.changes).toEqual([
      { offset: 0, before: 0, after: 1 },
      { offset: 5, before: 0, after: 1 },
    ]);
  });

  it("applies, undoes, and redoes an exact pixel patch", () => {
    const document = createIndexedDocument(3, 1, [transparent, ink]);
    const history = new PixelHistory();
    const patch = createPixelPatch(document, [
      { x: 0, y: 0, paletteIndex: 1 },
      { x: 1, y: 0, paletteIndex: 1 },
    ]);

    expect(history.commit(document, patch)).toBe(true);
    expect([...document.pixels]).toEqual([1, 1, 0]);
    expect(history.undo(document)).toBe(true);
    expect([...document.pixels]).toEqual([0, 0, 0]);
    expect(history.redo(document)).toBe(true);
    expect([...document.pixels]).toEqual([1, 1, 0]);
  });

  it("replays resolved patches identically on a fresh document", () => {
    const source = createIndexedDocument(2, 2, [transparent, ink]);
    const replay = createIndexedDocument(2, 2, [transparent, ink]);
    const patches = [
      createPixelPatch(source, [{ x: 0, y: 0, paletteIndex: 1 }]),
      createPixelPatch(source, [
        { x: 1, y: 0, paletteIndex: 1 },
        { x: 1, y: 1, paletteIndex: 1 },
      ]),
    ];

    for (const patch of patches) {
      applyPixelPatch(source, patch);
      applyPixelPatch(replay, patch);
    }

    expect(replay.pixels).toEqual(source.pixels);
  });

  it("uses the transparent palette index for erasing patches", () => {
    const document = createIndexedDocument(1, 1, [ink, transparent], 1);
    paintPixel(document, 0, 0, 0);
    const erase = createPixelPatch(document, [{ x: 0, y: 0, paletteIndex: document.transparentIndex }]);

    applyPixelPatch(document, erase);

    expect(document.pixels[0]).toBe(1);
  });
});
