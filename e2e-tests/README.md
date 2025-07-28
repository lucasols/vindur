# Vindur E2E Tests

This directory contains end-to-end tests for the Vindur CSS-in-JS library using Playwright.

## Setup

The e2e tests are set up as a separate workspace package with the following structure:

- `base-code/` - Template React application code used for testing
- `tests/` - Playwright test files
- `utils/` - Utility functions for starting Vite dev servers
- `playwright.config.ts` - Playwright configuration
- `package.json` - Dependencies and scripts

## Running Tests

From the root directory:

```bash
# Run all e2e tests
pnpm e2e:test

# Show test report
pnpm e2e:show-report
```

From the e2e-tests directory:

```bash
# Run tests
pnpm test

# Run specific test file
pnpm exec playwright test build-output.spec.ts

# Run tests in headed mode (with browser UI)
pnpm exec playwright test --headed
```

## Current Test Coverage

### Working Tests

- **build-output.spec.ts**: Tests that the basic React application structure is preserved during the build process

### Test Infrastructure

- **utils/startVite.ts**: Utility function that creates temporary directories with test applications and starts Vite dev servers
- **base-code/**: Simple React application template
- **Playwright configuration**: Set up for Chromium testing with appropriate timeouts

## Architecture

The e2e tests use a temporary directory approach where:

1. Test code is copied from `base-code/` to a temporary directory
2. A Vite dev server is started with the temporary directory as root
3. Playwright tests interact with the running application
4. Cleanup removes temporary directories after tests complete

This approach ensures test isolation and prevents conflicts between concurrent test runs.

## Future Enhancements

The test infrastructure is ready for expanded coverage of Vindur features:

- CSS template literal compilation and styling
- Styled component functionality
- CSS prop behavior
- CX prop conditional classes
- Hot reload functionality
- Production build CSS extraction

## Dependencies

- `@playwright/test`: Browser automation and testing
- `@vitejs/plugin-react-swc`: React support in Vite
- `vite`: Development server
- `react` and `react-dom`: React runtime for test applications
- `vindur` and `@vindur/vite`: The libraries being tested (workspace dependencies)