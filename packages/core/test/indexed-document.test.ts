// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";
import {
  applyPixelPatch,
  createPixelPatchJournalEvent,
  createPixelPatch,
  createIndexedDocument,
  decodeJournalEvent,
  decodePortableDocument,
  encodeJournalEvent,
  encodePortableDocument,
  invertPixelPatch,
  paintPixel,
  PixelHistory,
  replayJournalEvents,
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

  it("round-trips a versioned portable document checkpoint", () => {
    const document = createIndexedDocument(2, 2, [ink, transparent], 1);
    paintPixel(document, 1, 0, 0);
    paintPixel(document, 0, 1, 0);

    const restored = decodePortableDocument(encodePortableDocument(document));

    expect(restored).not.toBe(document);
    expect(restored.palette).toEqual(document.palette);
    expect(restored.transparentIndex).toBe(1);
    expect(restored.pixels).toEqual(document.pixels);
  });

  it("rejects portable documents whose pixels reference missing palette entries", () => {
    const invalid = JSON.stringify({
      schemaVersion: 1,
      width: 1,
      height: 1,
      transparentIndex: 0,
      palette: [transparent],
      pixels: [7],
    });

    expect(() => decodePortableDocument(invalid)).toThrow("missing palette entry");
  });

  it("round-trips a journal event and replays its resolved patch", () => {
    const source = createIndexedDocument(2, 1, [transparent, ink]);
    const replay = createIndexedDocument(2, 1, [transparent, ink]);
    const patch = createPixelPatch(source, [{ x: 1, y: 0, paletteIndex: 1 }]);
    const event = createPixelPatchJournalEvent(patch, "event-1", "2026-07-18T00:00:00.000Z");

    const restoredEvent = decodeJournalEvent(encodeJournalEvent(event));
    applyPixelPatch(replay, restoredEvent.patch);

    expect(restoredEvent).toEqual(event);
    expect([...replay.pixels]).toEqual([0, 1]);
  });

  it("records undo and redo as forward-replayable patches", () => {
    const document = createIndexedDocument(2, 1, [transparent, ink]);
    const history = new PixelHistory();
    const draw = createPixelPatch(document, [{ x: 0, y: 0, paletteIndex: 1 }]);
    history.commit(document, draw);

    const undo = history.undoAsPatch(document);
    const redo = history.redoAsPatch(document);

    expect(undo).toEqual(invertPixelPatch(draw));
    expect(redo).toEqual(draw);
    expect([...document.pixels]).toEqual([1, 0]);
  });

  it("replays a validated journal from its origin document", () => {
    const origin = createIndexedDocument(2, 1, [transparent, ink]);
    const draw = createPixelPatch(origin, [{ x: 1, y: 0, paletteIndex: 1 }]);
    const undo = invertPixelPatch(draw);
    const events = [
      createPixelPatchJournalEvent(draw, "draw", "2026-07-18T00:00:00.000Z"),
      createPixelPatchJournalEvent(undo, "undo", "2026-07-18T00:00:01.000Z"),
    ];

    expect([...replayJournalEvents(origin, events).pixels]).toEqual([0, 0]);
  });

  it("rejects corrupt or out-of-order journal replay", () => {
    const origin = createIndexedDocument(1, 1, [transparent, ink]);
    const invalidPatch = {
      width: 1,
      height: 1,
      changes: [{ offset: 0, before: 1, after: 0 }],
    };
    const event = createPixelPatchJournalEvent(invalidPatch, "invalid", "2026-07-18T00:00:00.000Z");

    expect(() => replayJournalEvents(origin, [event])).toThrow("does not match the replay state");
  });
});
