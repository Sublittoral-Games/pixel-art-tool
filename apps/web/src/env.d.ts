/// <reference types="vite/client" />

declare module "gifenc" {
  interface GifFrameOptions {
    readonly palette?: readonly (readonly number[])[];
    readonly delay?: number;
    readonly repeat?: number;
    readonly transparent?: boolean;
    readonly transparentIndex?: number;
  }

  interface GifEncoder {
    writeFrame(index: Uint8Array, width: number, height: number, options?: GifFrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
  }

  export function GIFEncoder(): GifEncoder;
}
