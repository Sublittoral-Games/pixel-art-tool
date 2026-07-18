<!-- SPDX-License-Identifier: MPL-2.0 -->

<script setup lang="ts">
import type { IndexedDocument, PixelWrite } from "@pixel-art-tool/core";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{
  document: IndexedDocument;
  disabled: boolean;
  paletteIndex: number;
  revision: number;
}>();

const emit = defineEmits<{
  commit: [writes: readonly PixelWrite[]];
}>();

interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

interface DocumentPoint {
  readonly x: number;
  readonly y: number;
}

interface NavigationStart {
  readonly centroid: ScreenPoint;
  readonly distance: number;
  readonly viewX: number;
  readonly viewY: number;
  readonly zoom: number;
}

const canvas = ref<HTMLCanvasElement>();
const zoomLabel = ref("100%");
const activePointers = new Map<number, ScreenPoint>();
const preview = new Map<number, number>();
const view = { x: 0, y: 0, zoom: 1 };

let resizeObserver: ResizeObserver | undefined;
let hasFit = false;
let interaction: "idle" | "draw" | "navigate" = "idle";
let drawingPointer: number | undefined;
let lastDrawPoint: DocumentPoint | undefined;
let hoverPoint: DocumentPoint | undefined;
let navigationStart: NavigationStart | undefined;
let spacePressed = false;
let mouseNavigationPointer: number | undefined;

function render(): void {
  const element = canvas.value;
  if (!element) {
    return;
  }

  const context = element.getContext("2d");
  if (!context) {
    return;
  }

  const ratio = window.devicePixelRatio || 1;
  const bounds = element.getBoundingClientRect();
  const backingWidth = Math.max(1, Math.round(bounds.width * ratio));
  const backingHeight = Math.max(1, Math.round(bounds.height * ratio));
  if (element.width !== backingWidth || element.height !== backingHeight) {
    element.width = backingWidth;
    element.height = backingHeight;
  }

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, bounds.width, bounds.height);
  context.fillStyle = "#11141a";
  context.fillRect(0, 0, bounds.width, bounds.height);

  const pixelSize = view.zoom;
  for (let y = 0; y < props.document.height; y += 1) {
    for (let x = 0; x < props.document.width; x += 1) {
      const offset = y * props.document.width + x;
      const previewIndex = preview.get(offset);
      const paletteIndex = previewIndex ?? props.document.pixels[offset];
      const color = paletteIndex === undefined ? undefined : props.document.palette[paletteIndex];
      const screenX = view.x + x * pixelSize;
      const screenY = view.y + y * pixelSize;

      if (!color || color.rgba[3] === 0) {
        context.fillStyle = (x + y) % 2 === 0 ? "#d9dde5" : "#b8bfca";
      } else {
        const [red, green, blue, alpha] = color.rgba;
        context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`;
      }
      context.fillRect(screenX, screenY, pixelSize + 0.25, pixelSize + 0.25);

      if (previewIndex !== undefined) {
        context.fillStyle = "rgba(255, 255, 255, 0.18)";
        context.fillRect(screenX, screenY, pixelSize, pixelSize);
      }
    }
  }

  const width = props.document.width * pixelSize;
  const height = props.document.height * pixelSize;
  context.strokeStyle = "rgba(255, 255, 255, 0.5)";
  context.lineWidth = 1;
  context.strokeRect(view.x - 0.5, view.y - 0.5, width + 1, height + 1);

  if (pixelSize >= 8) {
    context.beginPath();
    context.strokeStyle = "rgba(22, 26, 34, 0.2)";
    for (let x = 1; x < props.document.width; x += 1) {
      const screenX = view.x + x * pixelSize;
      context.moveTo(screenX, view.y);
      context.lineTo(screenX, view.y + height);
    }
    for (let y = 1; y < props.document.height; y += 1) {
      const screenY = view.y + y * pixelSize;
      context.moveTo(view.x, screenY);
      context.lineTo(view.x + width, screenY);
    }
    context.stroke();
  }

  if (hoverPoint && interaction === "idle") {
    renderHoverPreview(context, hoverPoint, pixelSize);
  }

  zoomLabel.value = `${Math.round((view.zoom / Math.max(1, fittedPixelSize())) * 100)}%`;
}

function renderHoverPreview(context: CanvasRenderingContext2D, point: DocumentPoint, pixelSize: number): void {
  const color = props.document.palette[props.paletteIndex];
  if (!color) {
    return;
  }

  const screenX = view.x + point.x * pixelSize;
  const screenY = view.y + point.y * pixelSize;
  const [red, green, blue, alpha] = color.rgba;

  if (alpha === 0) {
    context.fillStyle = (point.x + point.y) % 2 === 0 ? "#d9dde5" : "#b8bfca";
  } else {
    context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${Math.max(0.7, alpha / 255)})`;
  }
  context.fillRect(screenX, screenY, pixelSize, pixelSize);

  context.strokeStyle = "rgba(17, 20, 26, 0.9)";
  context.lineWidth = 3;
  context.strokeRect(screenX + 1.5, screenY + 1.5, Math.max(0, pixelSize - 3), Math.max(0, pixelSize - 3));
  context.strokeStyle = "rgba(255, 255, 255, 0.95)";
  context.lineWidth = 1;
  context.strokeRect(screenX + 0.5, screenY + 0.5, Math.max(0, pixelSize - 1), Math.max(0, pixelSize - 1));
}

function fittedPixelSize(): number {
  const element = canvas.value;
  if (!element) {
    return 1;
  }
  const bounds = element.getBoundingClientRect();
  return Math.max(1, Math.min(20, Math.floor(Math.min(
    (bounds.width - 40) / props.document.width,
    (bounds.height - 40) / props.document.height,
  ))));
}

function fitCanvas(): void {
  const element = canvas.value;
  if (!element) {
    return;
  }
  const bounds = element.getBoundingClientRect();
  view.zoom = fittedPixelSize();
  view.x = Math.round((bounds.width - props.document.width * view.zoom) / 2);
  view.y = Math.round((bounds.height - props.document.height * view.zoom) / 2);
  hasFit = true;
  render();
}

function handleResize(): void {
  if (!hasFit) {
    fitCanvas();
    return;
  }
  render();
}

function eventPoint(event: PointerEvent | WheelEvent): ScreenPoint {
  const bounds = canvas.value?.getBoundingClientRect();
  return {
    x: event.clientX - (bounds?.left ?? 0),
    y: event.clientY - (bounds?.top ?? 0),
  };
}

function documentPoint(point: ScreenPoint): DocumentPoint | undefined {
  const x = Math.floor((point.x - view.x) / view.zoom);
  const y = Math.floor((point.y - view.y) / view.zoom);
  if (x < 0 || x >= props.document.width || y < 0 || y >= props.document.height) {
    return undefined;
  }
  return { x, y };
}

function addLine(from: DocumentPoint, to: DocumentPoint): void {
  let x = from.x;
  let y = from.y;
  const deltaX = Math.abs(to.x - from.x);
  const deltaY = Math.abs(to.y - from.y);
  const stepX = from.x < to.x ? 1 : -1;
  const stepY = from.y < to.y ? 1 : -1;
  let error = deltaX - deltaY;

  while (true) {
    preview.set(y * props.document.width + x, props.paletteIndex);
    if (x === to.x && y === to.y) {
      break;
    }
    const doubledError = error * 2;
    if (doubledError > -deltaY) {
      error -= deltaY;
      x += stepX;
    }
    if (doubledError < deltaX) {
      error += deltaX;
      y += stepY;
    }
  }
}

function beginDrawing(event: PointerEvent, point: ScreenPoint): void {
  const pixel = documentPoint(point);
  if (!pixel) {
    return;
  }
  hoverPoint = undefined;
  interaction = "draw";
  drawingPointer = event.pointerId;
  lastDrawPoint = pixel;
  addLine(pixel, pixel);
  render();
}

function pointerCentroid(points: readonly ScreenPoint[]): ScreenPoint {
  const totals = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  return { x: totals.x / points.length, y: totals.y / points.length };
}

function pointerDistance(points: readonly ScreenPoint[]): number {
  if (points.length < 2 || !points[0] || !points[1]) {
    return 1;
  }
  return Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
}

function resetNavigationStart(): void {
  const points = [...activePointers.values()];
  if (points.length === 0) {
    navigationStart = undefined;
    return;
  }
  navigationStart = {
    centroid: pointerCentroid(points),
    distance: pointerDistance(points),
    viewX: view.x,
    viewY: view.y,
    zoom: view.zoom,
  };
}

function beginNavigation(): void {
  preview.clear();
  hoverPoint = undefined;
  drawingPointer = undefined;
  lastDrawPoint = undefined;
  interaction = "navigate";
  resetNavigationStart();
  render();
}

function updateNavigation(): void {
  const start = navigationStart;
  const points = [...activePointers.values()];
  if (!start || points.length === 0) {
    return;
  }

  const centroid = pointerCentroid(points);
  const scale = points.length > 1 ? pointerDistance(points) / start.distance : 1;
  const nextZoom = Math.min(48, Math.max(1, start.zoom * scale));
  const anchorX = (start.centroid.x - start.viewX) / start.zoom;
  const anchorY = (start.centroid.y - start.viewY) / start.zoom;
  view.zoom = nextZoom;
  view.x = centroid.x - anchorX * nextZoom;
  view.y = centroid.y - anchorY * nextZoom;
  render();
}

function handlePointerDown(event: PointerEvent): void {
  if (props.disabled) {
    return;
  }
  if (event.button !== 0 && event.button !== 1) {
    return;
  }
  try {
    canvas.value?.setPointerCapture(event.pointerId);
  } catch {
    // Synthetic pointer events used by browser tests do not create a capturable pointer.
  }
  const point = eventPoint(event);
  activePointers.set(event.pointerId, point);

  if (event.pointerType === "touch") {
    const touchCount = activePointers.size;
    if (touchCount > 1) {
      beginNavigation();
    } else {
      beginDrawing(event, point);
    }
    return;
  }

  if (event.button === 1 || spacePressed) {
    mouseNavigationPointer = event.pointerId;
    beginNavigation();
    return;
  }

  beginDrawing(event, point);
}

function handlePointerMove(event: PointerEvent): void {
  if (!activePointers.has(event.pointerId)) {
    updateHoverPreview(event);
    return;
  }
  const point = eventPoint(event);
  activePointers.set(event.pointerId, point);

  if (interaction === "navigate") {
    updateNavigation();
    return;
  }

  if (interaction === "draw" && drawingPointer === event.pointerId) {
    const pixel = documentPoint(point);
    if (pixel && lastDrawPoint) {
      addLine(lastDrawPoint, pixel);
      lastDrawPoint = pixel;
      render();
    }
  }
}

function updateHoverPreview(event: PointerEvent): void {
  if (interaction !== "idle" || event.buttons !== 0 || (event.pointerType !== "pen" && event.pointerType !== "mouse")) {
    return;
  }

  const nextHoverPoint = documentPoint(eventPoint(event));
  if (nextHoverPoint?.x === hoverPoint?.x && nextHoverPoint?.y === hoverPoint?.y) {
    return;
  }
  hoverPoint = nextHoverPoint;
  render();
}

function handlePointerLeave(): void {
  if (interaction === "idle" && hoverPoint) {
    hoverPoint = undefined;
    render();
  }
}

function finishDrawing(): void {
  const writes: PixelWrite[] = [...preview.entries()].map(([offset, paletteIndex]) => ({
    x: offset % props.document.width,
    y: Math.floor(offset / props.document.width),
    paletteIndex,
  }));
  preview.clear();
  if (writes.length > 0) {
    emit("commit", writes);
  }
}

function snapZoom(point: ScreenPoint): void {
  const oldZoom = view.zoom;
  const nextZoom = Math.min(48, Math.max(1, Math.round(oldZoom)));
  const anchorX = (point.x - view.x) / oldZoom;
  const anchorY = (point.y - view.y) / oldZoom;
  view.zoom = nextZoom;
  view.x = point.x - anchorX * nextZoom;
  view.y = point.y - anchorY * nextZoom;
}

function handlePointerEnd(event: PointerEvent): void {
  const point = eventPoint(event);
  const wasDrawing = interaction === "draw" && drawingPointer === event.pointerId;
  activePointers.delete(event.pointerId);

  if (wasDrawing) {
    finishDrawing();
    interaction = "idle";
    drawingPointer = undefined;
    lastDrawPoint = undefined;
  } else if (interaction === "navigate") {
    if (activePointers.size === 0 || mouseNavigationPointer === event.pointerId) {
      snapZoom(point);
      interaction = "idle";
      navigationStart = undefined;
      mouseNavigationPointer = undefined;
    } else {
      resetNavigationStart();
    }
  }
  if (interaction === "idle" && (event.pointerType === "pen" || event.pointerType === "mouse")) {
    hoverPoint = documentPoint(point);
  }
  render();
}

function handlePointerCancel(): void {
  activePointers.clear();
  preview.clear();
  hoverPoint = undefined;
  interaction = "idle";
  drawingPointer = undefined;
  lastDrawPoint = undefined;
  navigationStart = undefined;
  mouseNavigationPointer = undefined;
  render();
}

function handleWheel(event: WheelEvent): void {
  event.preventDefault();
  const point = eventPoint(event);
  const oldZoom = view.zoom;
  const nextZoom = Math.min(48, Math.max(1, oldZoom * Math.exp(-event.deltaY * 0.002)));
  const anchorX = (point.x - view.x) / oldZoom;
  const anchorY = (point.y - view.y) / oldZoom;
  view.zoom = nextZoom;
  view.x = point.x - anchorX * nextZoom;
  view.y = point.y - anchorY * nextZoom;
  render();
}

function handleKeyDown(event: KeyboardEvent): void {
  if (event.code === "Space" && !event.repeat) {
    spacePressed = true;
    event.preventDefault();
  }
}

function handleKeyUp(event: KeyboardEvent): void {
  if (event.code === "Space") {
    spacePressed = false;
  }
}

watch(() => props.revision, render);
watch(() => props.paletteIndex, render);
watch(() => props.document, fitCanvas);

onMounted(() => {
  resizeObserver = new ResizeObserver(handleResize);
  if (canvas.value) {
    resizeObserver.observe(canvas.value);
  }
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  fitCanvas();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  window.removeEventListener("keydown", handleKeyDown);
  window.removeEventListener("keyup", handleKeyUp);
});
</script>

<template>
  <div class="canvas-stage">
    <canvas
      ref="canvas"
      aria-label="Pixel canvas"
      :aria-disabled="disabled"
      data-testid="pixel-canvas"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerleave="handlePointerLeave"
      @pointerup="handlePointerEnd"
      @pointercancel="handlePointerCancel"
      @wheel="handleWheel"
    />
    <button class="fit-control" type="button" aria-label="Fit canvas" @click="fitCanvas">
      Fit · {{ zoomLabel }}
    </button>
  </div>
</template>
