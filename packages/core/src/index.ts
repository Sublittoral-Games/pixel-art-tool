// SPDX-License-Identifier: MPL-2.0

export interface PaletteEntry {
  readonly id: string;
  readonly name: string;
  readonly rgba: readonly [red: number, green: number, blue: number, alpha: number];
}

export interface IndexedDocument {
  readonly width: number;
  readonly height: number;
  readonly transparentIndex: number;
  readonly palette: readonly PaletteEntry[];
  readonly pixels: Uint8Array;
}

export interface PixelWrite {
  readonly x: number;
  readonly y: number;
  readonly paletteIndex: number;
}

export interface PixelChange {
  readonly offset: number;
  readonly before: number;
  readonly after: number;
}

export interface PixelPatch {
  readonly width: number;
  readonly height: number;
  readonly changes: readonly PixelChange[];
}

export function createIndexedDocument(
  width: number,
  height: number,
  palette: readonly PaletteEntry[],
  transparentIndex = 0,
): IndexedDocument {
  assertDimension(width, "width");
  assertDimension(height, "height");

  if (palette.length === 0 || palette.length > 256) {
    throw new RangeError("An indexed palette must contain between 1 and 256 entries.");
  }

  if (!Number.isInteger(transparentIndex) || transparentIndex < 0 || transparentIndex >= palette.length) {
    throw new RangeError("The transparent index must refer to an existing palette entry.");
  }

  const pixels = new Uint8Array(width * height);
  pixels.fill(transparentIndex);

  return { width, height, palette, pixels, transparentIndex };
}

export function paintPixel(document: IndexedDocument, x: number, y: number, paletteIndex: number): void {
  assertCoordinates(document, x, y);
  assertPaletteIndex(document, paletteIndex);

  document.pixels[y * document.width + x] = paletteIndex;
}

export function createPixelPatch(document: IndexedDocument, writes: readonly PixelWrite[]): PixelPatch {
  const changesByOffset = new Map<number, PixelChange>();

  for (const write of writes) {
    assertCoordinates(document, write.x, write.y);
    assertPaletteIndex(document, write.paletteIndex);

    const offset = write.y * document.width + write.x;
    const current = document.pixels[offset];
    if (current === undefined) {
      throw new RangeError("Pixel coordinates are outside the document.");
    }

    const existing = changesByOffset.get(offset);
    changesByOffset.set(offset, {
      offset,
      before: existing?.before ?? current,
      after: write.paletteIndex,
    });
  }

  const changes = [...changesByOffset.values()]
    .filter((change) => change.before !== change.after)
    .sort((left, right) => left.offset - right.offset);

  return { width: document.width, height: document.height, changes };
}

export function applyPixelPatch(
  document: IndexedDocument,
  patch: PixelPatch,
  direction: "forward" | "backward" = "forward",
): void {
  if (patch.width !== document.width || patch.height !== document.height) {
    throw new RangeError("Pixel patch dimensions do not match the document.");
  }

  for (const change of patch.changes) {
    if (!Number.isInteger(change.offset) || change.offset < 0 || change.offset >= document.pixels.length) {
      throw new RangeError("Pixel patch contains an invalid offset.");
    }

    const paletteIndex = direction === "forward" ? change.after : change.before;
    assertPaletteIndex(document, paletteIndex);
    document.pixels[change.offset] = paletteIndex;
  }
}

export class PixelHistory {
  readonly #undoStack: PixelPatch[] = [];
  readonly #redoStack: PixelPatch[] = [];

  get canUndo(): boolean {
    return this.#undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.#redoStack.length > 0;
  }

  commit(document: IndexedDocument, patch: PixelPatch): boolean {
    if (patch.changes.length === 0) {
      return false;
    }

    applyPixelPatch(document, patch);
    this.#undoStack.push(patch);
    this.#redoStack.length = 0;
    return true;
  }

  undo(document: IndexedDocument): boolean {
    const patch = this.#undoStack.pop();
    if (!patch) {
      return false;
    }

    applyPixelPatch(document, patch, "backward");
    this.#redoStack.push(patch);
    return true;
  }

  redo(document: IndexedDocument): boolean {
    const patch = this.#redoStack.pop();
    if (!patch) {
      return false;
    }

    applyPixelPatch(document, patch);
    this.#undoStack.push(patch);
    return true;
  }
}

export function replacePaletteEntry(
  document: IndexedDocument,
  paletteIndex: number,
  replacement: PaletteEntry,
): IndexedDocument {
  if (!Number.isInteger(paletteIndex) || paletteIndex < 0 || paletteIndex >= document.palette.length) {
    throw new RangeError("Palette index is outside the document palette.");
  }

  const palette = [...document.palette];
  palette[paletteIndex] = replacement;
  return { ...document, palette };
}

export function renderRgba(document: IndexedDocument): Uint8ClampedArray {
  const output = new Uint8ClampedArray(document.pixels.length * 4);

  for (let pixelOffset = 0; pixelOffset < document.pixels.length; pixelOffset += 1) {
    const paletteIndex = document.pixels[pixelOffset];
    const color = paletteIndex === undefined ? undefined : document.palette[paletteIndex];
    if (!color) {
      throw new Error(`Pixel ${pixelOffset} refers to missing palette index ${String(paletteIndex)}.`);
    }

    output.set(color.rgba, pixelOffset * 4);
  }

  return output;
}

function assertDimension(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 2048) {
    throw new RangeError(`Document ${label} must be an integer between 1 and 2048.`);
  }
}

function assertCoordinates(document: IndexedDocument, x: number, y: number): void {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= document.width || y < 0 || y >= document.height) {
    throw new RangeError("Pixel coordinates are outside the document.");
  }
}

function assertPaletteIndex(document: IndexedDocument, paletteIndex: number): void {
  if (!Number.isInteger(paletteIndex) || paletteIndex < 0 || paletteIndex >= document.palette.length) {
    throw new RangeError("Palette index is outside the document palette.");
  }
}
