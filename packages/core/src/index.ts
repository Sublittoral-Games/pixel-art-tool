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
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= document.width || y < 0 || y >= document.height) {
    throw new RangeError("Pixel coordinates are outside the document.");
  }

  if (!Number.isInteger(paletteIndex) || paletteIndex < 0 || paletteIndex >= document.palette.length) {
    throw new RangeError("Palette index is outside the document palette.");
  }

  document.pixels[y * document.width + x] = paletteIndex;
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

