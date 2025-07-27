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
import { styled } from 'vindur';

const Button = styled.button`
  background: blue;
  color: white;
  padding: 12px 24px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
`;

export default function App() {
  return <Button>Click me</Button>;
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
  return <button className="vhash123-1">Click me</button>;
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
import { styled } from 'vindur';

const Title = styled.h1`
  font-size: 24px;
  color: #333;
  margin-bottom: 16px;
`;

const Card = styled.div`
  background: white;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
`;

const Container = styled.main`
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
`;
```

### Variable Interpolation

Interpolate JavaScript variables into your styles:

```tsx
const primaryColor = '#007bff';
const spacing = 16;

const Button = styled.button`
  background: ${primaryColor};
  padding: ${spacing}px ${spacing * 2}px;
  margin: ${spacing / 2}px;
`;
```

### Style Extension

Extend existing styled components using `styled()`:

```tsx
const BaseButton = styled.button`
  padding: 12px 24px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
`;

const PrimaryButton = styled(BaseButton)`
  background: #007bff;
  color: white;
`;

const SecondaryButton = styled(BaseButton)`
  background: #6c757d;
  color: white;
`;
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
`;

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
`;
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
`;

const styleWithCss = css`
  ${baseStyles}:hover & {
    background: #007bff;
    color: white;
  }
`;
```

Components defined after the styled components are also supported by using `${() => Component}` syntax to avoid used before defined error:

```tsx
const Card = styled.div`
  background: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

  ${() => Container}:hover & {
    background: #007bff;
    color: white;
  }
`;

const Container = styled.div`
  background: #007bff;
  color: white;
  border-color: #0056b3;
`;
```

### CSS Style Extension

Extend CSS styles from `css` function into styled components using semicolon extension:

```tsx
import { css, styled } from 'vindur';

const baseStyles = css`
  padding: 16px;
  border-radius: 8px;
  border: 1px solid #ddd;
`;

const Card = styled.div`
  ${baseStyles};
  background: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
`;

const PrimaryCard = styled.div`
  ${baseStyles};
  background: #007bff;
  color: white;
  border-color: #0056b3;
`;

// extend css styles from css function is supported too
const styleWithCss = css`
  ${baseStyles};
  background: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
`;

const Component = () => {
  return (
    <div>
      <Card>Hello</Card>
      <PrimaryCard>Hello</PrimaryCard>
      <div className={styleWithCss}>Hello</div>
    </div>
  );
};
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
  );
};
```

Css extension will also work from imports:

```tsx
import { css } from 'vindur';
import { baseStyles } from './styles';

const styles = css`
  ${baseStyles};
  padding: 12px 24px;
  border-radius: 4px;
  font-weight: 500;
`;
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

### CSS Keyframes

Create CSS animations using the `keyframes` function:

```tsx
import { keyframes, styled } from 'vindur';

const fadeIn = keyframes`
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const slideIn = keyframes`
  0% {
    transform: translateX(-100%);
  }
  50% {
    transform: translateX(-10px);
  }
  100% {
    transform: translateX(0);
  }
`;

const AnimatedCard = styled.div`
  background: white;
  padding: 20px;
  animation: ${fadeIn} 0.3s ease-out;

  &:hover {
    animation: ${slideIn} 0.5s ease-in-out;
  }
`;
```

Keyframes support variable interpolation just like other CSS functions:

```tsx
const startPosition = '-100%';
const endPosition = '0';

const slideAnimation = keyframes`
  from {
    transform: translateX(${startPosition});
  }
  to {
    transform: translateX(${endPosition});
  }
`;
```

### Stable IDs

Generate deterministic, stable IDs with `stableId` or `createClassName` function, for using in styled components, CSS functions, and any other place where you may need stable IDs. The IDs will be compiled at build time.

```tsx
import { css, styled, generateClassName, stableId } from 'vindur';

// stableId marker creates stable class names based on variable name
export const elementClassName = createClassName();
export const genericPurposeId = stableId();

// is compiled to:
export const elementClassName = { selector: '.vhash-1', value: 'vhash-1' };
export const genericPurposeId = 'vhash-2';
```

You can then use it in styled components:

```tsx
import { elementClassName, genericPurposeId } from './styles';

const Element = styled.div`
  ${elementClassName.selector} {
    background: red;
    --value: ${genericPurposeId};
  }
`;
```

Or any other place where you may need a stable ID:

```tsx
const Component = () => {
  return (
    <div className={elementClassName.value}>
      <div id={genericPurposeId}>Hello</div>
    </div>
  );
};
```

### Global Styles

Create global CSS styles that apply to the entire document using `createGlobalStyle`:

```tsx
import { createGlobalStyle } from 'vindur';

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
`;
```

Global styles support variable interpolation just like regular styles:

```tsx
const primaryColor = '#007bff';
const fontFamily = 'Inter, system-ui, sans-serif';

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
`;
```

And also references to styled components are supported:

```tsx
const Button = styled.button`
  padding: 12px 24px;
`;

createGlobalStyle`
  ${Button} {
    background: #007bff;
    color: white;
  }
`;
```

### Mixins and Functions

Create reusable style functions with `vindurFn`:

```tsx
// utils/styles.ts
import { vindurFn } from 'vindur';

export const flexCenter = vindurFn(
  () => `
  display: flex;
  align-items: center;
  justify-content: center;
`,
);

export const buttonSize = vindurFn((size: 'sm' | 'md' | 'lg') =>
  size === 'sm' ? 'padding: 6px 12px; font-size: 14px;'
  : size === 'md' ? 'padding: 8px 16px; font-size: 16px;'
  : 'padding: 12px 24px; font-size: 18px;',
);

// components/Button.tsx
import { styled } from 'vindur';
import { flexCenter, buttonSize } from '../utils/styles';

const Button = styled.button`
  ${flexCenter()};
  ${buttonSize('md')};
  background: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`;
```

### JSX CSS Prop

Apply styles directly to JSX elements using the `css` prop, similar to styled-components and emotion:

```tsx
import { css } from 'vindur';

const App = () => (
  <div
    css={`
      background: blue;
      padding: 20px;
      color: white;
    `}
  >
    Hello World
  </div>
);
```

The `css` prop works with native DOM elements and styled components:

```tsx
const Card = styled.div`
  background: white;
  padding: 20px;
`;

const App = () => (
  <Card
    css={`
      border: 1px solid red;
    `}
  >
    Card with additional styling
  </Card>
);
```

You can also use CSS function references:

```tsx
const buttonStyles = css`
  background: #007bff;
  color: white;
  padding: 8px 16px;
`;

const Button = ({ children }) => <button css={buttonStyles}>{children}</button>;
```

The `css` prop automatically merges with existing `className` attributes:

```tsx
<div
  className="existing-class"
  css={`
    color: green;
    font-weight: bold;
  `}
>
  Styled content
</div>
```

**Note**: The `css` prop only works with native DOM elements (like `div`, `span`, `button`) and styled components. It does not work with custom React components.

## Theme Colors

Create type-safe theme color systems with `createStaticThemeColors`:

```tsx
import { createStaticThemeColors } from 'vindur';

const colors = createStaticThemeColors({
  primary: '#007bff',
  secondary: '#6c757d',
  success: '#28a745',
  danger: '#dc3545',
  warning: '#ffc107',
  info: '#17a2b8',
});

// Each color provides a complete theming API
const Button = styled.button`
  background: ${colors.primary.var};
  color: ${colors.primary.contrast.var};

  &:hover {
    background: ${colors.primary.darker(0.1)};
  }

  &:active {
    background: ${colors.primary.alpha(0.8)};
  }
`;
```

The generated css will be optimized with the values of the colors:

```css
.v1560qbr-1-Button {
  background: #007bff;
  color: #fff;

  &:hover {
    background: #0056b3;
  }

  &:active {
    background: #0056b380;
  }
}
```

In dev mode, the output will show the color name for easier debugging:

```css
.v1560qbr-1-Button {
  background: var(--stc-primary-var, #007bff);
  color: var(--stc-primary-contrast-var, #fff);

  &:hover {
    background: var(--stc-primary-darker-0\.1, #0056b3);
  }

  &:active {
    background: var(--stc-primary-alpha-0\.8, #0056b380);
  }
}
```

### Color API

Each color in your theme provides:

- **`var`**: CSS variable reference for the color
- **`defaultHex`**: The original hex value passed in
- **`alpha(amount)`**: Creates an alpha variant of the color
- **`darker(amount)`**: Creates a darker variant (0-1 scale)
- **`lighter(amount)`**: Creates a lighter variant (0-1 scale)
- **`contrast.var`**: CSS variable for optimal contrast color
- **`contrast.optimal(options?)`**: Generates optimal contrast in which light colors use a saturated dark color instead of black as contrast
- **`contrast.alpha(amount)`**: Creates an alpha variant of the contrast color

## Dynamic Theme Colors

Create dynamic color systems that can be customized at runtime with `createDynamicCssColor`:

```tsx
import { createDynamicCssColor } from 'vindur';

const dynamicColor = createDynamicCssColor();

const Container = styled.div`
  background: ${dynamicColor.var};
  color: ${dynamicColor.contrast.var};

  /* use self selectors to conditionally style the component that is setting the color */
  ${dynamicColor.self.isDark} {
    border: 2px solid white;
  }
`;

const Card = styled.div`
  background: ${dynamicColor.var};
  color: ${dynamicColor.contrast.var};

  &:hover {
    background: ${dynamicColor.darker(0.1)};
  }

  /* use container selectors to conditionally style child components */
  ${dynamicColor.container.isLight} {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
`;

const ChildElement = styled.div`
  background: ${dynamicColor.var};
  color: ${dynamicColor.contrast.var};
`;

// for dom elements, and styled components you can use the dynamicColors prop to set the color
const MyComponent = () => {
  return (
    <div dynamicColor={dynamicColor}>
      <Card>This card adapts to the dynamic color</Card>
    </div>
  );
};

// for custom components, you can use the color.setProps to set the color
const MyComponent = () => {
  return (
    <div {...dynamicColor.setProps('#ff6b6b')}>
      <Card>This card adapts to the dynamic color</Card>
    </div>
  );
};

// multiple colors can be passed to dynamicColor prop
const MyComponent = () => {
  return (
    <div dynamicColor={[dynamicColor1, dynamicColor2]}>
      <Card>This card adapts to the dynamic color</Card>
    </div>
  );
};
```

### Dynamic Color API

Dynamic colors provide the same color manipulation functions as static colors, plus:

#### Color Setting

- **`setProps(hexColor, options?)`**: Sets the color value and returns className and style props
  - `hexColor`: The color to set
  - `options.style?`: Additional CSS properties to merge
  - `options.className?`: Additional class names to merge
  - `options.setColorScheme?`: Configure color scheme detection with fallback

#### Conditional Selectors

- **`self.*`**: Selectors for the component that sets the color
- **`container.*`**: Selectors for child components

Available conditional selectors:

- **`isDark`**: When the set color is considered dark
- **`isLight`**: When the set color is considered light
- **`isDefined`**: When a color has been set
- **`isNotDefined`**: When no color has been set
- **`isVeryDark`**: When the color is very dark (high contrast needed)
- **`isNotVeryDark`**: When the color is not very dark
- **`isVeryLight`**: When the color is very light (high contrast needed)
- **`isNotVeryLight`**: When the color is not very light

### Usage Examples

```tsx
// Color setting with additional styles
const { className, style } = dynamicColor.setInComponent('#007bff', {
  style: { padding: '20px' },
  className: 'custom-card',
  setColorScheme: { fallback: 'dark' },
});

// Conditional styling based on color properties
const AdaptiveButton = styled.button`
  background: ${dynamicColor.var};
  color: ${dynamicColor.contrast.var};

  /* Different styles for dark vs light colors */
  &${dynamicColor.self.isDark} {
    border: 1px solid ${dynamicColor.lighter(0.2)};
  }

  &${dynamicColor.self.isLight} {
    border: 1px solid ${dynamicColor.darker(0.2)};
  }

  /* Conditional styles in parent containers */
  ${dynamicColor.container.isDefined} & {
    transition: all 0.2s ease;
  }
`;
```

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for upcoming features and development plans.

## License

MIT
