This file provides guidance to Code Agents when working with code in this repository.

# Development Philosophy

Vindur is a compiler, and compilers have endless edge cases. Do not try to cover them all: support a small, well-defined set of patterns and reject everything else.

## Restricted feature set, fail fast

- Prefer a restricted set of supported syntax and patterns over handling every corner case. A narrow feature that is always correct beats a broad one with gaps
- When code falls outside the supported set, emit a clear error (or a warning when the output is still correct) that tells the user what to write instead. Never guess, fall back, or silently compile to something wrong
- Do not add special-case handling for rare patterns (aliased imports, re-exports, indirect references, computed values, unusual module shapes, etc.) unless there is a real use case. Rejecting them with a good error is the default
- When fixing a bug in an edge case, first consider whether the pattern should be unsupported instead of handled, even if it is already supported: removing support and erroring is preferred over complex handling, but confirm with the user before removing support for an already supported pattern. A pattern that builds without error and then breaks at runtime is never an acceptable "leave as is"
- Keep the supported surface easy to describe in the README. If a feature needs a long list of exceptions to explain, it is probably too broad

## Performance

Performance is a priority on both sides of the compiler:

1. **Runtime performance of the generated code** comes first: the output runs in every user's app (see "Runtime performance" below)
2. **Compilation speed** comes second. The core compiler is written in Rust, so it is already fast; do not trade output quality or correctness for small compile-time gains. Still avoid features that need expensive analysis (whole-program evaluation, deep cross-module resolution, repeated parsing, unbounded recursion), restricting the feature instead

If a feature can only be supported with slow compilation or runtime overhead, restrict or drop it.

# Running ts code

The node version installed supports running ts code directly. No build step is needed. Just use `node` to run ts code

# Development Commands

**Important:** Use `pnpm` only, never `npx`.
DO NOT USE `npx` to run commands, NEVER.

# Git and Publishing Workflow

These are pre-approved, do them without asking the user for confirmation:

- Always deliver changes through a pull request: create a branch from `main`, commit, push and open the PR with `gh pr create`. Never commit directly to `main`
- Publish packages only from `main`, after the PR with the changes is merged: switch to an up-to-date `main` and run `pkg-manager publish <package-name> --type <patch|minor|major>` from the repo root, publishing only the affected packages in the order described in `RELEASING.md`

# Code Style Guidelines

- Use types instead of interfaces

# Runtime performance

Vindur is a compile-time library: work should happen at build time, not in the user's bundle.

- Avoid adding runtime overhead to the generated code, prefer resolving values at compile time
- Prefer the cheapest correct output, e.g. string concatenation (`(className || "") + " cls"`) over allocating helpers like `[a, b].filter(Boolean).join(" ")`
- Only emit runtime guards or helper calls when the value can't be statically proven, e.g. skip guards for string literals and `css` constants
- Reuse existing runtime helpers (e.g. `cx`) instead of emitting new wrappers around them

# Error handling

- The transform is strict about errors ('Fail Fast'): it either succeeds 100% or fails on any error, unexpected behavior, or unhandled case. No fallback values or partial results.
- Use warnings only for non-fatal suggestions: optimizations, unused code (e.g. a `styled` component that is never used), or potential issues. Warnings are surfaced to the user as ESLint warnings.
- IMPORTANT: every error and warning must carry a source location so the right code gets highlighted. If the exact location isn't available, use the nearest one.

# Typesafety

- Do not use `any`
- Do not use `as Type` casts, except for `as const`
- Do not use non-null assertions (`!`)
- Avoid using optional parameters, use default values or `| undefined` instead

# Code Organization

- Abstract redundant types into a single type
- Abstract redundant code into a single function
- Split up large or complex functions into smaller functions
- Do not use barrel files
- NEVER use re-exports

# VERY IMPORTANT CODE QUALITY GUIDELINES

- NEVER use `eslint-disable`, `eslint-disable-next-line`, or similar comments to disable eslint rules, fix the underlying issue causing the rule to be violated instead.
- NEVER use `@ts-expect-error` or `@ts-ignore` to skip type errors, fix the underlying issue causing the type error instead.
- NEVER override eslint rules with comments (e.g: `/* eslint max-lines: ["error", 700] */`), fix the underlying issue causing the rule to be violated instead.

# Testing

- Do not update snapshots via `vitest run --u`, update them manually
- If there are too many snapshots to update manually, ask for the user to update them

Before writing or changing tests, load the matching skill: `vindur-lib-tests` (Vitest tests in `lib/tests/`) or `vindur-e2e-tests` (Playwright tests in `e2e-tests/`).

# Documentation

## README.md

The README.md serves as the main user documentation and should:

- **Focus on implemented features only** - do not document planned/future features
- **Use concise examples** - keep code examples short and focused
- **Use correct syntax** - ensure all examples use supported language features
- Be concise and to the point, do not include unnecessary details or redundant information

## Documentation Updates

When implementing features:

1. **Update README.md** - add documentation section with examples
2. **Keep examples current** - ensure examples match actual implementation
3. **Test examples** - verify all documentation examples actually work

# Feature implementation guidelines

1. Add or adjust documentation in README.md
2. If the feature has complex implementation, document it in SPEC.md
3. Implement the tests
   - The feature may be already implemented, so run the tests first
4. If the feature is not simple, wait me for review the tests first
5. Implement the feature
6. Ensure all tests pass and no other features are broken
7. Run tsc and lint and fix all errors

# Static Analysis and Template Literals

All Vindur CSS-in-JS features that use template literals are **statically analyzed at compile-time**:

- **Static values are allowed**: String literals, numbers, constants defined at module level
- **Dynamic runtime values are NOT allowed**: State variables, props, function calls, or any values that change at runtime
- **Use vindurFn for reusable CSS functions**: `vindurFn` functions are evaluated at compile-time, so they must be exported and can only be called inside vindur styles with static arguments. For values that change at runtime, use dynamic colors, scoped CSS variables set through the `style` prop, or style flags

**Valid examples:**

```tsx
const BRAND_COLOR = '#667eea'; // Static constant - OK

const styles = css`
  color: ${BRAND_COLOR}; // Static variable - OK
  padding: 16px; // Literal value - OK
`;
```

**Invalid examples:**

```tsx
function Component({ color, isActive }) {
  const styles = css`
    color: ${color}; // ❌ Dynamic prop - NOT allowed
    padding: ${isActive ? 16 : 8}px; // ❌ Dynamic expression - NOT allowed
  `;
}
```

**For reusable CSS functions, use vindurFn:**

```tsx
// mixins.ts
export const spacing = vindurFn(
  (size: number, isCompact: boolean) => `
  padding: ${isCompact ? size / 2 : size}px;
`,
);

// Button.tsx
const Button = styled.button`
  ${spacing(16, false)}; // ✅ static arguments inside a vindur style
`;
```

This applies to: `css`, `styled.*`, `css` prop, `keyframes`, and `createGlobalStyle`.
