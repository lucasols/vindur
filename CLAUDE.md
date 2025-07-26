# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

This is a monorepo using pnpm workspaces for **Vindur** - a compile-time CSS-in-JS library focused on performance. The project is organized into:

- `lib/` - Core library package with Babel transform logic
- `app-test/` - React test application using Vite for development and testing
- `notes/spec.md` - Feature specifications and roadmap

## Development Commands

Do not use `npx` to run commands, use `pnpm` only

### Library Development (lib/)

```bash
cd lib
pnpm lint          # Run TypeScript check + ESLint
pnpm tsc           # TypeScript compilation check
pnpm eslint        # ESLint only
```

Running ts code

The node version installed supports running ts code directly. No build step is needed. Just use `node` to run ts code

### Test Application (app-test/)

```bash
cd app-test
pnpm dev           # Start Vite dev server
pnpm build         # Build for production
pnpm preview       # Preview production build
```

## Architecture

### Core Transform Logic

The library centers around a Babel-based transform function in `lib/src/transform.ts` that:

- Extracts CSS from template literals (`css` function calls)
- Generates hashed class names
- Returns both transformed JavaScript and extracted CSS

### Build System

- **tsup** for library building (ESM + CJS outputs)
- **Vite** for test app development
- **ESLint** with TypeScript integration
- **pnpm** workspaces for monorepo management

### Key Features (Planned)

- `css` function for template literal styles
- `styled.*` component functions
- Variable interpolation and mixins
- Scoped classes and CSS variables
- JSX `cx` and `css` props
- Global styles and media queries

## Code Style Guidelines

- Use types instead of interfaces

## Plugin error handling

- The plugin should be strict about errors, it should either be 100% successful or fail if a error or unexpected behavior, or unhandled case occurs, no fallback values or partial results should be returned

## Typesafety

- Do not use `any`
- Do not use `as Type` casts, except for `as const`
- Do not use non-null assertions (`!`)
- Avoid using optional parameters, use default values or `| undefined` instead

## Code Organization

- Abstract redundant types into a single type

## Testing

Tests use Vitest and are located in `lib/tests/`. Run tests from the lib directory:

```bash
cd lib
pnpm test         # Run tests
```

- Prefer using `toMatchInlineSnapshot` when possible
- Do not update snapshots via `vitest run --u`, update them manually
- If test failures are due to minor snapshot changes or coding formatting, just ignore them, i will update them manually

# Styled components tests

Tests should follow this structure:

```tsx
// ...

test('should handle ...', async () => {
  const result = await transformWithFormat({
    source: dedent`
      // ...
    `,
  })

  expect(result.code).toMatchInlineSnapshot(`
    // ...
  `)

  expect(result.css).toMatchInlineSnapshot(`
    // ...
  `)
})
```

## Documentation Guidelines

### README.md

The README.md serves as the main user documentation and should:

- **Focus on implemented features only** - do not document planned/future features
- **Use concise examples** - keep code examples short and focused
- **Use correct syntax** - ensure all examples use supported language features
- Be concise and to the point, do not include unnecessary details or redundant information

### ROADMAP.md

The ROADMAP.md tracks feature development:

- **Use checkboxes** - `[x]` for completed, `[ ]` for planned
- **Status indicators** - ✅ (completed), 🚧 (in progress), 🔮 (future)

### Documentation Updates

When implementing features:

1. **Update ROADMAP.md** - mark features as completed `[x]` and change status to ✅
2. **Update README.md** - add documentation section with examples
3. **Keep examples current** - ensure examples match actual implementation
4. **Test examples** - verify all documentation examples actually work
