# Contributing

Thanks for improving Rewind Overlay.

1. Open an issue for large behavioral or data-contract changes.
2. Create a focused branch from `main`.
3. Run `npm run typecheck`, `npm test`, and `npm run build`.
4. Keep official API parsing inside `electron/rwfc.ts`; do not couple the
   renderer to an upstream response shape.
5. Preserve reduced-motion behavior for every new animation.
6. Never commit game files, NAND data, friend-code fixtures from real players,
   signing material, or uploaded artwork.

Pull requests should explain the user-facing result and include tests for data
mapping or state transitions.

