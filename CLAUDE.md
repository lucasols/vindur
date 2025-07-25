# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

This is a monorepo using pnpm workspaces for **Vindur** - a compile-time CSS-in-JS library focused on performance. The project is organized into:

- `lib/` - Core library package with Babel transform logic
- `app-test/` - React test application using Vite for development and testing
- `notes/spec.md` - Feature specifications and roadmap

## Development Commands

### Library Development (lib/)

```bash
cd lib
pnpm lint          # Run TypeScript check + ESLint
pnpm tsc           # TypeScript compilation check
pnpm eslint        # ESLint only
pnpm build         # Full build with linting
pnpm build:no-test # Build without linting (tsup)
```

### Test Application (app-test/)

```bash
cd app-test
pnpm dev           # Start Vite dev server
pnpm build         # Build for production
pnpm preview       # Preview production build
```

### Testing

Tests use Vitest and are located in `lib/tests/`. Run tests from the lib directory:

```bash
cd lib
pnpm test         # Run tests
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

## Typesafety

- Do not use `any`
- Do not use `as Type` casts, except for `as const`
- Do not use non-null assertions (`!`)
- Avoid using optional parameters, use default values or `| undefined` instead
