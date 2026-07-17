# Pixel Art Tool

Pixel Art Tool is an early-stage, local-first pixel-art editor for desktop, tablet, and phone browsers. The product direction is intentionally narrow: make a small Piskel-like editor feel excellent everywhere, start with a genuinely linked indexed palette and timelapse-ready history, and add deeper animation and pixel-aware construction tools in tested increments.

## Repository status

This repository contains the public application code. Private product research, planning, and working documents live in a separate `Pixel Art Tool Docs` repository.

The current scaffold proves the intended technical boundary:

- `apps/web`: Vue 3 responsive PWA shell and browser adapters
- `packages/core`: DOM-free indexed-pixel document logic and tests

The previous experimental MCP/vector prototype is a reference only and is not the foundation of this project.

## Development

Requirements:

- Node.js 24 LTS
- Corepack with pnpm 10

```bash
corepack enable
pnpm install
pnpm dev
```

Before opening a pull request:

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Project principles

- The document model, not the canvas, is the source of truth.
- Indexed pixels store palette indices; editing a palette entry changes every use without rewriting pixel buffers.
- The core package has no DOM or Vue dependencies.
- Drawing operations become deterministic commands at commit time so undo, recovery, autosave, and timelapse can share one foundation.
- Touch, Pencil, mouse, and trackpad are first-class inputs; keyboard shortcuts are accelerators, not requirements.
- The first usable release stays small enough to test on iPhone, iPad, and desktop continuously.

## License and branding

Source code is available under the [Mozilla Public License 2.0](LICENSE). Distributed modifications to covered source files remain available under MPL-2.0, and existing notices must be preserved.

The license does not grant rights to Sublittoral Games names, logos, or product branding. Unofficial forks must use distinct branding and clearly identify themselves as forks; see [TRADEMARKS.md](TRADEMARKS.md).
