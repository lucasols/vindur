This file provides guidance to Code Agents when working with code in this repository.

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

# Plugin error handling

- The plugin should be strict about errors in transform process, using the 'Fail Fast' approach, it should either be 100% successful or fail if a error or unexpected behavior, or unhandled case occurs, no fallback values or partial results should be returned. Only use warnings for optimization suggestions or such as removing unused code, etc.

- Transform errors should use `TransformError` class, with properly set `loc` and `message`
- IMPORTANT: Do not throw TransformError without a proper location! If is not possible to provide the exact error location, use the nearest available location.

# Warnings

Warnings are used to flag potential issues or suggest optimizations without failing the build. They are surfaced to the user as ESLint warnings.

**Use cases for warnings:**

- **Optimization suggestions:** e.g., suggesting a more efficient way to write a style.
- **Unused code:** e.g., a defined `styled` component that is never used.
- **Potential issues:** e.g., a CSS property that might not be supported in all target browsers.

**Implementation:**

- Warnings must be created using the `Warning` class from `lib/src/custom-errors.ts`.
- Each warning must include:
  - `message`: A clear and concise description of the issue.
  - `loc`: The Babel `SourceLocation` of the code causing the warning. This is crucial for ESLint to highlight the correct code.
- Warnings should be propagated to the user via the `onWarning` callback.

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

## ROADMAP.md

The ROADMAP.md tracks feature development:

- **Use checkboxes** - `[x]` for completed, `[ ]` for planned
- **Status indicators** - ✅ (completed), 🚧 (in progress), 🔮 (future)

## Documentation Updates

When implementing features:

1. **Update ROADMAP.md** - mark features as completed `[x]` and change status to ✅
2. **Update README.md** - add documentation section with examples
3. **Keep examples current** - ensure examples match actual implementation
4. **Test examples** - verify all documentation examples actually work

# Feature implementation guidelines

1. Add or adjust documentation in README.md
2. If the feature has complex implementation, document it in SPEC.md
3. Implement the tests
   - The feature may be already implemented, so run the tests first
4. If the feature is not simple, wait me for review the tests first
5. Implement the feature
6. Ensure all tests pass and no other features are broken
7. Run tsc and lint and fix all errors
8. Update ROADMAP.md

## Code Optimization Memories

- Use `filterWithNarrowing` instead of type guards on array.map
- Use `findWithNarrowing` instead of type guards on array.find

## Static Analysis and Template Literals

All Vindur CSS-in-JS features that use template literals are **statically analyzed at compile-time**:

- **Static values are allowed**: String literals, numbers, constants defined at module level
- **Dynamic runtime values are NOT allowed**: State variables, props, function calls, or any values that change at runtime
- **Use vindurFn for dynamic CSS**: When you need CSS that depends on runtime values, wrap your function with `vindurFn`

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

**For dynamic CSS, use vindurFn:**

```tsx
const dynamicStyles = vindurFn(
  (color: string, isActive: boolean) => `
  color: ${color};              // ✅ OK inside vindurFn
  padding: ${isActive ? 16 : 8}px;  // ✅ OK inside vindurFn
`,
);
```

This applies to: `css`, `styled.*`, `css` prop, `keyframes`, and `createGlobalStyle`.

## Hash generation

Vindur generates unique, deterministic hashes for CSS classes and variables using a file-scoped system.

### Hash Format

- **File hash**: `v${murmur2(filePath)}` (e.g., "v1560qbr")
- **Development**: `{fileHash}-{index}-{name}` (e.g., "v1560qbr-1-Button")
- **Production**: `{fileHash}-{index}` (e.g., "v1560qbr-1")

### Index Assignment

All Vindur features share a **file-scoped incremental counter**:

```tsx
const styles = css`
  color: red;
`; // Index 1
<div cx={{ active: true }} />; // Index 2
const Button = styled.button`
  color: blue;
`; // Index 3
<div cx={{ test: true, loading: true }} />; // test uses index 4, loading gets index 5
```

**Key rules:**

- Same names within a file reuse the same index
- Different names get sequential indices
- Each file has its own hash and counter space
