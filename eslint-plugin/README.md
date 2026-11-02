# @vindur-css/eslint-plugin

ESLint plugin for Vindur CSS-in-JS that surfaces transform errors and warnings directly in your IDE.

## Installation

```bash
npm install --save-dev @vindur-css/eslint-plugin
```

## Usage

Add the plugin to your ESLint config:

```js
// eslint.config.js
import { vindurPlugin } from '@vindur-css/eslint-plugin';

export default [
  {
    plugins: {
      '@vindur': vindurPlugin,
    },
    rules: {
      '@vindur/check-transform': 'error',
    },
  },
];
```

Or use the recommended configuration:

```js
// eslint.config.js
import { vindurPlugin } from '@vindur-css/eslint-plugin';

export default [
  vindurPlugin.configs.recommended,
];
```

### oxlint

The package default export is the plugin, so it can be loaded as an oxlint JS plugin:

```json
{
  "jsPlugins": [{ "name": "@vindur", "specifier": "@vindur-css/eslint-plugin" }],
  "rules": {
    "@vindur/check-transform": "error"
  }
}
```

## Rule: `@vindur/check-transform`

This rule runs the Vindur transform on your files and reports any errors or warnings.

### Options

The rule accepts an options object:

```js
{
  rules: {
    '@vindur/check-transform': ['error', {
      // Path aliases for import resolution
      importAliases: {
        '@': './src',
        'components': './src/components'
      },

      // The colorSchemeClassNames option of the vite plugin, so the scheme
      // classes used in styles are not reported as undeclared
      colorSchemeClassNames: { light: 'lm', dark: 'dm' },
      
      // Enable dev mode behavior (default: true)
      dev: true,
      
      // Report warnings as ESLint warnings (default: true)
      reportWarnings: true
    }]
  }
}
```

### What it detects

- **Transform errors**: Invalid Vindur syntax, unsupported operations, etc.
- **Missing CSS classes**: When `cx` prop references classes not defined in styles
- **Missing modifier styles**: When style flags are used but corresponding CSS is missing
- **Undeclared scoped variables**: When CSS variables are used but not declared

## Features

- **Real-time feedback**: Errors and warnings appear directly in your IDE
- **Performance optimized**: Uses caching to avoid re-running transforms unnecessarily
- **Smart file filtering**: Only processes files that contain Vindur usage
- **TypeScript support**: Full TypeScript types included

## Requirements

- ESLint 9.0+
- Vindur 0.6.0+