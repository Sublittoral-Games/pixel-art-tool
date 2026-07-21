// SPDX-License-Identifier: MPL-2.0

import {
  applyPixelPatch,
  cloneIndexedDocument,
  renderRgba,
  type IndexedDocument,
  type PixelPatchJournalEvent,
} from "@pixel-art-tool/core";

export interface TimelapseCapability {
  readonly webCodecs: boolean;
  readonly mp4Avc: boolean;
  readonly detail: string;
}

export interface TimelapseExport {
  readonly blob: Blob;
  readonly extension: "mp4" | "gif";
  readonly capability: TimelapseCapability;
}

const frameDurationSeconds = 0.25;
const frameDelayMilliseconds = frameDurationSeconds * 1_000;

export async function probeTimelapseCapability(width: number, height: number): Promise<TimelapseCapability> {
  if (typeof VideoEncoder === "undefined") {
    return { webCodecs: false, mp4Avc: false, detail: "WebCodecs unavailable; GIF fallback ready" };
  }

  try {
    const support = await VideoEncoder.isConfigSupported({
      codec: "avc1.42001f",
      width: evenDimension(width),
      height: evenDimension(height),
      bitrate: 1_500_000,
      framerate: 4,
      hardwareAcceleration: "no-preference",
      avc: { format: "avc" },
    });
    return support.supported
      ? { webCodecs: true, mp4Avc: true, detail: "WebCodecs AVC/MP4 ready" }
      : { webCodecs: true, mp4Avc: false, detail: "AVC encoder unavailable; GIF fallback ready" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "codec probe failed";
    return { webCodecs: true, mp4Avc: false, detail: `AVC probe failed; GIF fallback ready (${message})` };
  }
}

export async function exportTimelapse(
  origin: IndexedDocument,
  events: readonly PixelPatchJournalEvent[],
  forceGif = false,
): Promise<TimelapseExport> {
  const dimensions = outputDimensions(origin);
  const capability = await probeTimelapseCapability(dimensions.width, dimensions.height);

  if (capability.mp4Avc && !forceGif) {
    try {
      return {
        blob: await encodeMp4(origin, events, dimensions),
        extension: "mp4",
        capability,
      };
    } catch {
      // A positive capability probe does not guarantee that a device can finish encoding.
    }
  }

  return {
    blob: await encodeGif(origin, events, dimensions),
    extension: "gif",
    capability,
  };
}

async function encodeMp4(
  origin: IndexedDocument,
  events: readonly PixelPatchJournalEvent[],
  dimensions: OutputDimensions,
): Promise<Blob> {
  const {
    BufferTarget,
    CanvasSource,
    Mp4OutputFormat,
    Output,
    QUALITY_MEDIUM,
  } = await import("mediabunny");
  const canvas = createFrameCanvas(dimensions);
  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target,
  });
  const source = new CanvasSource(canvas, {
    codec: "avc",
    bitrate: QUALITY_MEDIUM,
    keyFrameInterval: 1,
  });
  output.addVideoTrack(source, { frameRate: 4 });
  await output.start();

  let timestamp = 0;
  for (const document of replayFrames(origin, events)) {
    drawFrame(canvas, document, dimensions, false);
    await source.add(timestamp, frameDurationSeconds, { keyFrame: timestamp === 0 });
    timestamp += frameDurationSeconds;
  }
  await output.finalize();

  if (!target.buffer) {
    throw new Error("The MP4 muxer returned no data.");
  }
  return new Blob([target.buffer], { type: "video/mp4" });
}

async function encodeGif(
  origin: IndexedDocument,
  events: readonly PixelPatchJournalEvent[],
  dimensions: OutputDimensions,
): Promise<Blob> {
  const { GIFEncoder } = await import("gifenc");
  const gif = GIFEncoder();
  const palette = origin.palette.map((entry) => entry.rgba.slice(0, 3));
  let first = true;

  for (const document of replayFrames(origin, events)) {
    gif.writeFrame(scaleIndexedPixels(document, dimensions), dimensions.width, dimensions.height, {
      ...(first ? { palette } : {}),
      delay: frameDelayMilliseconds,
      repeat: 0,
      transparent: true,
      transparentIndex: document.transparentIndex,
    });
    first = false;
  }
  gif.finish();
  const encoded = gif.bytes();
  const buffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buffer).set(encoded);
  return new Blob([buffer], { type: "image/gif" });
}

function* replayFrames(
  origin: IndexedDocument,
  events: readonly PixelPatchJournalEvent[],
): Generator<IndexedDocument> {
  const document = cloneIndexedDocument(origin);
  yield document;
  for (const event of events) {
    if (event.patch.width !== document.width || event.patch.height !== document.height) {
      throw new RangeError("A timelapse journal event does not match its origin document.");
    }
    for (const change of event.patch.changes) {
      if (document.pixels[change.offset] !== change.before) {
        throw new RangeError(`Timelapse event ${event.id} does not match the replay state.`);
      }
    }
    applyPixelPatch(document, event.patch);
    yield document;
  }
}

interface OutputDimensions {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
}

function outputDimensions(document: IndexedDocument): OutputDimensions {
  const scale = Math.max(1, Math.floor(512 / Math.max(document.width, document.height)));
  return {
    width: evenDimension(document.width * scale),
    height: evenDimension(document.height * scale),
    scale,
  };
}

function evenDimension(value: number): number {
  return value % 2 === 0 ? value : value + 1;
}

function createFrameCanvas(dimensions: OutputDimensions): HTMLCanvasElement {
  const canvas = window.document.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  return canvas;
}

function drawFrame(
  target: HTMLCanvasElement,
  document: IndexedDocument,
  dimensions: OutputDimensions,
  preserveTransparency: boolean,
): void {
  const context = target.getContext("2d");
  if (!context) {
    throw new Error("A 2D canvas is required for timelapse export.");
  }
  const source = window.document.createElement("canvas");
  source.width = document.width;
  source.height = document.height;
  const sourceContext = source.getContext("2d");
  if (!sourceContext) {
    throw new Error("A 2D canvas is required for timelapse export.");
  }
  const rgba = renderRgba(document);
  const pixels = new Uint8ClampedArray(new ArrayBuffer(rgba.byteLength));
  pixels.set(rgba);
  sourceContext.putImageData(new ImageData(pixels, document.width, document.height), 0, 0);

  context.clearRect(0, 0, target.width, target.height);
  if (!preserveTransparency) {
    context.fillStyle = "#f4efe0";
    context.fillRect(0, 0, target.width, target.height);
  }
  context.imageSmoothingEnabled = false;
  context.drawImage(
    source,
    0,
    0,
    document.width,
    document.height,
    0,
    0,
    document.width * dimensions.scale,
    document.height * dimensions.scale,
  );
}

function scaleIndexedPixels(document: IndexedDocument, dimensions: OutputDimensions): Uint8Array {
  const output = new Uint8Array(dimensions.width * dimensions.height);
  output.fill(document.transparentIndex);
  for (let y = 0; y < document.height; y += 1) {
    for (let x = 0; x < document.width; x += 1) {
      const paletteIndex = document.pixels[y * document.width + x] ?? document.transparentIndex;
      for (let scaledY = 0; scaledY < dimensions.scale; scaledY += 1) {
        const rowOffset = (y * dimensions.scale + scaledY) * dimensions.width + x * dimensions.scale;
        output.fill(paletteIndex, rowOffset, rowOffset + dimensions.scale);
      }
    }
  }
  return output;
}
