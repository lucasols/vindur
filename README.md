# Vindur

A compile-time CSS-in-JS library focused on performance.

## Overview

Vindur is a CSS-in-JS library that compiles your styles at build time, generating optimized CSS and injecting class names directly into your JSX. No runtime overhead, no flash of unstyled content, just fast and efficient styling.

## Performance

### Compile-Time Optimization

- ✅ **Zero runtime overhead** - all styles compiled at build time
- ✅ **Optimized CSS output** - dead code elimination and minification
- ✅ **Direct class injection** - no wrapper components or runtime style injection
- ✅ **Efficient bundling** - only used styles are included in the output

### Build Integration

Vindur works with your existing build tools:

- **Vite** - Built-in plugin support
- More build tools coming soon

## Installation

```bash
npm install vindur @vindur-css/vite
# or
pnpm add vindur @vindur-css/vite
# or
yarn add vindur @vindur-css/vite
```

## Quick Start

```tsx
import { styled } from 'vindur'

const Button = styled.button`
  background: blue;
  color: white;
  padding: 12px 24px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
`

export default function App() {
  return <Button>Click me</Button>
}
```

Compiles to:

```css
/* Generated CSS */
.vhash123-1 {
  background: blue;
  color: white;
  padding: 12px 24px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
}
```

```tsx
// Generated JSX, no runtime overhead!!
export default function App() {
  return <button className="vhash123-1">Click me</button>
}
```

## Core Features

### CSS Function

Create reusable CSS styles with the `css` function:

```tsx
import { css } from 'vindur'

const buttonBase = css`
  padding: 12px 24px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
`

// Use in className
<button className={buttonBase}>Click me</button>
```

### Styled Components

Create styled JSX components with any HTML element:

```tsx
import { styled } from 'vindur'

const Title = styled.h1`
  font-size: 24px;
  color: #333;
  margin-bottom: 16px;
`

const Card = styled.div`
  background: white;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
`

const Container = styled.main`
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
`
```

### Variable Interpolation

Interpolate JavaScript variables into your styles:

```tsx
const primaryColor = '#007bff'
const spacing = 16

const Button = styled.button`
  background: ${primaryColor};
  padding: ${spacing}px ${spacing * 2}px;
  margin: ${spacing / 2}px;
`
```

### Style Extension

Extend existing styled components using `styled()`:

```tsx
const BaseButton = styled.button`
  padding: 12px 24px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
`

const PrimaryButton = styled(BaseButton)`
  background: #007bff;
  color: white;
`

const SecondaryButton = styled(BaseButton)`
  background: #6c757d;
  color: white;
`
```

### Nesting Styles

Vindur supports CSS nesting using the native CSS nesting standard:

```tsx
const Card = styled.div`
  background: white;
  padding: 20px;

  h3 {
    color: #333;
    margin-bottom: 16px;
  }

  &:hover {
    transform: translateY(-2px);
  }

  @media (max-width: 768px) {
    padding: 16px;
  }
`

const Navigation = styled.nav`
  ul {
    list-style: none;
    display: flex;

    li a {
      color: #333;
      text-decoration: none;

      &:hover {
        background: #f5f5f5;
      }
    }
  }
`
```

**Output**: Native CSS nesting preserved as-is:

```css
.v1234567-1 {
  background: white;
  padding: 20px;

  h3 {
    color: #333;
    margin-bottom: 16px;
  }

  &:hover {
    transform: translateY(-2px);
  }

  @media (max-width: 768px) {
    padding: 16px;
  }
}
```

### Styled Component References

Reference other styled components within CSS selectors using the `&` operator:

```tsx
const Card = styled.div`
  background: white;
  padding: 20px;
  border-radius: 8px;
`

const Button = styled.button`
  background: #007bff;
  color: white;
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
`

const Container = styled.div`
  ${Card}:hover & {
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(0,0,0,0.15);
  }

  & ${Button}:hover {
    background: #0056b3;
  }
`

// Usage
<Container>
  <Card>
    <h3>Card Title</h3>
    <Button>Action</Button>
  </Card>
</Container>
```

Compiles to CSS using native CSS nesting:

```css
.v1560qbr-1 {
  background: white;
  padding: 20px;
  border-radius: 8px;
}

.v1560qbr-2 {
  background: #007bff;
  color: white;
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
}

.v1560qbr-3 {
  .v1560qbr-1:hover & {
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
  }

  & .v1560qbr-2:hover {
    background: #0056b3;
  }
}
```

**Native CSS Nesting**: The `&` selector is preserved as-is, leveraging the CSS Nesting standard supported by modern browsers. No additional transformation needed!

References also works with css function, and css function can be extended with css function:

```tsx
const Card = styled.div`
  ${baseStyles};
  background: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
`

const styleWithCss = css`
  ${baseStyles}:hover & {
    background: #007bff;
    color: white;
  }
`
```

### CSS Style Extension

Extend CSS styles from `css` function into styled components using semicolon extension:

```tsx
import { css, styled } from 'vindur'

const baseStyles = css`
  padding: 16px;
  border-radius: 8px;
  border: 1px solid #ddd;
`

const Card = styled.div`
  ${baseStyles};
  background: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
`

const PrimaryCard = styled.div`
  ${baseStyles};
  background: #007bff;
  color: white;
  border-color: #0056b3;
`

// extend css styles from css function is supported too
const styleWithCss = css`
  ${baseStyles};
  background: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
`

const Component = () => {
  return (
    <div>
      <Card>Hello</Card>
      <PrimaryCard>Hello</PrimaryCard>
      <div className={styleWithCss}>Hello</div>
    </div>
  )
}
```

Compiles to:

```css
.vhash-1-baseStyles {
  padding: 16px;
  border-radius: 8px;
  border: 1px solid #ddd;
}

.vhash-2-Card {
  background: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.vhash-3-PrimaryCard {
  background: #007bff;
  color: white;
  border-color: #0056b3;
}

.vhash-4-styleWithCss {
  background: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}
```

```tsx
const Component = () => {
  return (
    <div>
      <div className="vhash-1-baseStyles vhash-2-Card">Hello</div>
      <div className="vhash-1-baseStyles vhash-3-PrimaryCard">Hello</div>
      <div className="vhash-1-baseStyles vhash-4-styleWithCss">Hello</div>
    </div>
  )
}
```

### CSS as Selectors

Use CSS styles as selectors within styled components using the `&` operator:

```tsx
import { css, styled } from 'vindur'

const baseStyles = css`
  padding: 12px 24px;
  border-radius: 4px;
  font-weight: 500;
`

const Container = styled.div`
  padding: 20px;

  ${baseStyles} & {
    background: #f0f0f0;
    border: 1px solid #ddd;
  }

  &:hover ${baseStyles} {
    background: #007bff;
    color: white;
  }
`

// Usage
<Container>
  <button className={baseStyles}>Click me</button>
</Container>
```

Compiles to CSS using native CSS nesting:

```css
.vhash-1-baseStyles {
  padding: 12px 24px;
  border-radius: 4px;
  font-weight: 500;
}

.vhash-2-Container {
  padding: 20px;

  .vhash-1-baseStyles & {
    background: #f0f0f0;
    border: 1px solid #ddd;
  }

  &:hover .vhash-1-baseStyles {
    background: #007bff;
    color: white;
  }
}
```

### Global Styles

Create global CSS styles that apply to the entire document using `createGlobalStyle`:

```tsx
import { createGlobalStyle } from 'vindur'

// Global styles are applied directly without class wrappers
createGlobalStyle`
  body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
    color: #333;
    background: #fff;
  }

  * {
    box-sizing: border-box;
  }

  h1, h2, h3, h4, h5, h6 {
    margin: 0 0 1rem 0;
    font-weight: 600;
  }

  button {
    font-family: inherit;
  }

  @media (prefers-reduced-motion: reduce) {
    * {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
`
```

Global styles support variable interpolation just like regular styles:

````tsx
const primaryColor = '#007bff'
const fontFamily = 'Inter, system-ui, sans-serif'

createGlobalStyle`
  :root {
    --primary-color: ${primaryColor};
    --font-family: ${fontFamily};
  }

  body {
    font-family: var(--font-family);
    color: #333;
  }

  .highlight {
    color: ${primaryColor};
  }
`

And also references to styled components are supported:

```tsx
const Button = styled.button`
  padding: 12px 24px;
`

createGlobalStyle`
  ${Button} {
    background: #007bff;
    color: white;
  }
`
```

### Mixins and Functions

Create reusable style functions with `vindurFn`:

```tsx
// utils/styles.ts
import { vindurFn } from 'vindur'

export const flexCenter = vindurFn(
  () => `
  display: flex;
  align-items: center;
  justify-content: center;
`
)

export const buttonSize = vindurFn((size: 'sm' | 'md' | 'lg') =>
  size === 'sm'
    ? 'padding: 6px 12px; font-size: 14px;'
    : size === 'md'
      ? 'padding: 8px 16px; font-size: 16px;'
      : 'padding: 12px 24px; font-size: 18px;'
)

// components/Button.tsx
import { styled } from 'vindur'
import { flexCenter, buttonSize } from '../utils/styles'

const Button = styled.button`
  ${flexCenter()};
  ${buttonSize('md')};
  background: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`
```

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for upcoming features and development plans.

## License

MIT
````
