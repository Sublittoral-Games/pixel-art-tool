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

export interface PixelPatchJournalEvent {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly committedAt: string;
  readonly commandKind: "pixel-patch";
  readonly patch: PixelPatch;
}

interface PortableIndexedDocumentV1 {
  readonly schemaVersion: 1;
  readonly width: number;
  readonly height: number;
  readonly transparentIndex: number;
  readonly palette: readonly PaletteEntry[];
  readonly pixels: readonly number[];
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

export function invertPixelPatch(patch: PixelPatch): PixelPatch {
  return {
    width: patch.width,
    height: patch.height,
    changes: patch.changes.map((change) => ({
      offset: change.offset,
      before: change.after,
      after: change.before,
    })),
  };
}

export function createPixelPatchJournalEvent(
  patch: PixelPatch,
  id: string,
  committedAt: string,
): PixelPatchJournalEvent {
  if (id.length === 0) {
    throw new RangeError("A journal event id cannot be empty.");
  }
  if (Number.isNaN(Date.parse(committedAt))) {
    throw new RangeError("A journal event timestamp must be an ISO-compatible date.");
  }

  return { schemaVersion: 1, id, committedAt, commandKind: "pixel-patch", patch };
}

export function encodeJournalEvent(event: PixelPatchJournalEvent): string {
  validateJournalEvent(event);
  return JSON.stringify(event);
}

export function decodeJournalEvent(serialized: string): PixelPatchJournalEvent {
  return validateJournalEvent(parseJson(serialized, "journal event"));
}

export function encodePortableDocument(document: IndexedDocument): string {
  const portable: PortableIndexedDocumentV1 = {
    schemaVersion: 1,
    width: document.width,
    height: document.height,
    transparentIndex: document.transparentIndex,
    palette: document.palette,
    pixels: [...document.pixels],
  };
  return JSON.stringify(portable);
}

export function decodePortableDocument(serialized: string): IndexedDocument {
  const value = parseJson(serialized, "portable document");
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new RangeError("Portable document uses an unsupported schema version.");
  }

  const width = requireInteger(value.width, "width");
  const height = requireInteger(value.height, "height");
  const transparentIndex = requireInteger(value.transparentIndex, "transparent index");
  const palette = validatePortablePalette(value.palette);
  const pixels = validatePortablePixels(value.pixels, width, height, palette.length);
  const document = createIndexedDocument(width, height, palette, transparentIndex);
  document.pixels.set(pixels);
  return document;
}

export function cloneIndexedDocument(document: IndexedDocument): IndexedDocument {
  return decodePortableDocument(encodePortableDocument(document));
}

export function replayJournalEvents(
  origin: IndexedDocument,
  events: readonly PixelPatchJournalEvent[],
): IndexedDocument {
  const replay = cloneIndexedDocument(origin);
  const eventIds = new Set<string>();

  for (const event of events) {
    const validatedEvent = validateJournalEvent(event);
    if (eventIds.has(validatedEvent.id)) {
      throw new RangeError(`Journal contains duplicate event id ${validatedEvent.id}.`);
    }
    eventIds.add(validatedEvent.id);

    for (const change of validatedEvent.patch.changes) {
      if (replay.pixels[change.offset] !== change.before) {
        throw new RangeError(`Journal event ${validatedEvent.id} does not match the replay state.`);
      }
    }
    applyPixelPatch(replay, validatedEvent.patch);
  }

  return replay;
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
    return this.undoAsPatch(document) !== undefined;
  }

  undoAsPatch(document: IndexedDocument): PixelPatch | undefined {
    const patch = this.#undoStack.pop();
    if (!patch) {
      return undefined;
    }

    applyPixelPatch(document, patch, "backward");
    this.#redoStack.push(patch);
    return invertPixelPatch(patch);
  }

  redo(document: IndexedDocument): boolean {
    return this.redoAsPatch(document) !== undefined;
  }

  redoAsPatch(document: IndexedDocument): PixelPatch | undefined {
    const patch = this.#redoStack.pop();
    if (!patch) {
      return undefined;
    }

    applyPixelPatch(document, patch);
    this.#undoStack.push(patch);
    return patch;
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

function validateJournalEvent(value: unknown): PixelPatchJournalEvent {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.commandKind !== "pixel-patch") {
    throw new RangeError("Journal event uses an unsupported schema or command kind.");
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new RangeError("Journal event id is invalid.");
  }
  if (typeof value.committedAt !== "string" || Number.isNaN(Date.parse(value.committedAt))) {
    throw new RangeError("Journal event timestamp is invalid.");
  }

  const patch = validatePortablePatch(value.patch);
  return {
    schemaVersion: 1,
    id: value.id,
    committedAt: value.committedAt,
    commandKind: "pixel-patch",
    patch,
  };
}

function validatePortablePatch(value: unknown): PixelPatch {
  if (!isRecord(value) || !Array.isArray(value.changes)) {
    throw new RangeError("Journal event pixel patch is invalid.");
  }
  const width = requireInteger(value.width, "patch width");
  const height = requireInteger(value.height, "patch height");
  assertDimension(width, "width");
  assertDimension(height, "height");

  const changes: PixelChange[] = [];
  let previousOffset = -1;
  for (const change of value.changes) {
    if (!isRecord(change)) {
      throw new RangeError("Journal event contains an invalid pixel change.");
    }
    const offset = requireInteger(change.offset, "pixel change offset");
    const before = requireByte(change.before, "pixel change before index");
    const after = requireByte(change.after, "pixel change after index");
    if (offset <= previousOffset || offset >= width * height) {
      throw new RangeError("Journal event pixel offsets must be unique, sorted, and in bounds.");
    }
    previousOffset = offset;
    changes.push({ offset, before, after });
  }
  return { width, height, changes };
}

function validatePortablePalette(value: unknown): readonly PaletteEntry[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) {
    throw new RangeError("Portable document palette must contain between 1 and 256 entries.");
  }

  const ids = new Set<string>();
  return value.map((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id.length === 0 || typeof entry.name !== "string") {
      throw new RangeError("Portable document contains an invalid palette entry.");
    }
    if (ids.has(entry.id)) {
      throw new RangeError("Portable document palette ids must be unique.");
    }
    ids.add(entry.id);
    if (!Array.isArray(entry.rgba) || entry.rgba.length !== 4) {
      throw new RangeError("Portable document palette colors must contain four channels.");
    }
    const rgba = entry.rgba.map((channel) => requireByte(channel, "palette color channel"));
    const [red, green, blue, alpha] = rgba;
    if (red === undefined || green === undefined || blue === undefined || alpha === undefined) {
      throw new RangeError("Portable document palette colors must contain four channels.");
    }
    return { id: entry.id, name: entry.name, rgba: [red, green, blue, alpha] };
  });
}

function validatePortablePixels(
  value: unknown,
  width: number,
  height: number,
  paletteLength: number,
): Uint8Array {
  assertDimension(width, "width");
  assertDimension(height, "height");
  if (!Array.isArray(value) || value.length !== width * height) {
    throw new RangeError("Portable document pixel count does not match its dimensions.");
  }
  const pixels = new Uint8Array(value.length);
  value.forEach((pixel, offset) => {
    const paletteIndex = requireByte(pixel, "pixel palette index");
    if (paletteIndex >= paletteLength) {
      throw new RangeError(`Portable document pixel ${offset} refers to a missing palette entry.`);
    }
    pixels[offset] = paletteIndex;
  });
  return pixels;
}

function requireInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new RangeError(`Portable data ${label} must be an integer.`);
  }
  return value;
}

function requireByte(value: unknown, label: string): number {
  const integer = requireInteger(value, label);
  if (integer < 0 || integer > 255) {
    throw new RangeError(`Portable data ${label} must be between 0 and 255.`);
  }
  return integer;
}

function parseJson(serialized: string, label: string): unknown {
  try {
    return JSON.parse(serialized) as unknown;
  } catch {
    throw new SyntaxError(`Encoded ${label} is not valid JSON.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
