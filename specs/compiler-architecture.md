# Rust Compiler Architecture

Vindur compiles TypeScript and TSX through a native Rust pipeline based on Oxc. The JavaScript package exposes the existing `transform` API as a thin Node-API bridge; it does not parse or transform source with Babel.

## Crate boundaries

- `vindur_compiler` owns parsing, static analysis, module resolution, transforms, diagnostics, CSS extraction, and source metadata. It has no Node.js dependency and can be tested directly.
- `vindur_node` only converts Node-API inputs and outputs and delegates to a long-lived `vindur_compiler::Compiler`.
- `lib/src/rust-transform.ts` preserves the public TypeScript API, warning/error classes, observable function-cache behavior, and CSS source-map encoding.

Keeping the compiler independent from the binding keeps the hot transform code small and prevents JavaScript bridge concerns from spreading through compiler passes.

## Fast transform path

1. Oxc parses the source and builds semantic scopes, symbols, and references without the heavier node store or control-flow graph.
2. Oxc Resolver handles real filesystem resolution with a shared cache; the loader fallback preserves virtual/in-memory integrations.
3. The compiler resolves imports and caches serializable `ModuleFacts` for dependencies.
4. Independent passes consume the same AST, semantic identities, and immutable module facts.
5. Oxc ECMAScript analysis rejects side-effecting static expressions and provides JavaScript-accurate primitive conversions.
6. A source-order reservation pass assigns deterministic IDs even though feature passes run independently.
7. Non-overlapping source edits are applied in one batch.
8. The compatibility normalizer reparses edited output before applying formatting-only edits while retaining untouched source trivia.
9. Oxc template offsets are returned with generated CSS for source-map encoding.

The cache belongs to a long-lived compiler instance. Integrations should reuse their transform cache object and invalidate changed dependency paths, allowing unchanged imported functions, constants, objects, colors, keyframes, and CSS to avoid repeated analysis.

Oxc Transformer and Oxc Minifier are deliberately not part of Vindur. Vite owns TypeScript/JSX lowering and final bundle minification, avoiding duplicate work. Full-file Oxc codegen was also evaluated, but Oxc 0.139 canonicalizes original quotes and trivia and does not preserve every non-statement comment. Vindur therefore applies checked, non-overlapping span edits to retain source fidelity and avoid an additional full-file generation pass. This boundary can be revisited when codegen preserves the compatibility contract without slowing the hot path.

## Failure model

The pipeline is fail-fast. Parser and semantic diagnostics are converted directly from Oxc diagnostics; resolution, evaluation, or transform errors stop output generation and carry the nearest Oxc source span. Warnings are reserved for optimization and unused-style guidance.

## Compatibility testing

The existing TypeScript Vitest suite remains the behavioral contract and runs against the Rust compiler by default. Rust unit and integration tests cover parser boundaries, module caching, source-order reservations, CSS layers, source metadata, and the Node-API boundary.

## Integration benchmark

On the Inertia frontend production build, three alternating warm runs measured a median wall time of 10.03 seconds with the published Babel compiler and 8.79 seconds with the Rust/Oxc compiler, a 12.4% reduction. Both builds emitted 17 files with the same 2.2 MB aggregate disk footprint, and the Rust configuration passed all 75 Inertia frontend tests. These numbers describe that local application snapshot and are evidence for this architecture, not a universal speed guarantee.
