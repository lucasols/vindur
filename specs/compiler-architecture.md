# Rust Compiler Architecture

Vindur compiles TypeScript and TSX through a native Rust pipeline based on Oxc. The JavaScript package exposes the existing `transform` API as a thin Node-API bridge; it does not parse or transform source with Babel.

## Crate boundaries

- `vindur_compiler` owns parsing, static analysis, module resolution, transforms, diagnostics, CSS extraction, and source metadata. It has no Node.js dependency and can be tested directly.
- `vindur_node` only converts Node-API inputs and outputs and delegates to a long-lived `vindur_compiler::Compiler`.
- `lib/src/rust-transform.ts` preserves the public TypeScript API, warning/error classes, observable function-cache behavior, and CSS source-map encoding.

Keeping the compiler independent from the binding keeps the hot transform code small and prevents JavaScript bridge concerns from spreading through compiler passes.

## Fast transform path

1. Oxc parses each source module once.
2. The compiler resolves imports and caches serializable `ModuleFacts` for dependencies.
3. Independent passes consume the same AST and immutable module facts.
4. A source-order reservation pass assigns deterministic IDs even though feature passes run independently.
5. Non-overlapping source edits are applied in one batch.
6. Oxc template offsets are returned with generated CSS for source-map encoding.

The cache belongs to a long-lived compiler instance. Integrations should reuse their transform cache object and invalidate changed dependency paths, allowing unchanged imported functions, constants, objects, colors, keyframes, and CSS to avoid repeated analysis.

## Failure model

The pipeline is fail-fast. Parser, resolution, evaluation, or transform errors stop output generation and carry the nearest Oxc source span. Warnings are reserved for optimization and unused-style guidance.

## Compatibility testing

The existing TypeScript Vitest suite remains the behavioral contract and runs against the Rust compiler by default. Rust unit and integration tests cover parser boundaries, module caching, source-order reservations, CSS layers, source metadata, and the Node-API boundary.
