> Hash values are just examples, they not represent the actual hash values.

# Style Flags Transform Logic

## Overview

Style flags allow styled components to accept boolean props and string union props that automatically apply modifier classes. This enables conditional styling through prop-based class application. The props are automatically hashed for optimal bundle size.

Optimization goal: avoid generating intermediate React components for local (non-exported) styled components. Only generate intermediate components when the styled component is exported (or when `attrs` are present). Local usages are compiled directly to native elements with computed `className`.

## Detection and Validation

1. **Only apply to styled components** - not for regular DOM elements
2. **Extract type information** from styled component generic type parameters
3. **Identify style flag properties** in the component's prop type:
   - **Boolean properties**: `active: boolean`
   - **String literal unions**: `size: 'small' | 'large'`
4. **Generate modifier classes** for each style flag prop

## Component Definition

```tsx
const StyledWithModifiers = styled.div<{
  active: boolean;
  size: 'small' | 'medium' | 'large';
  disabled: boolean;
}>`
  padding: 16px;

  &.active {
    background: blue;
  }

  &.size-small {
    padding: 8px;
    font-size: 14px;
  }

  &.size-medium {
    padding: 16px;
    font-size: 16px;
  }

  &.size-large {
    padding: 24px;
    font-size: 18px;
  }

  &.disabled {
    opacity: 0.5;
    pointer-events: none;
  }
`;
```

## Transform Logic

### Export-Aware Behavior

- Non-exported styled components with style flags: inline transform at each JSX usage (no intermediate component).
- Exported styled components with style flags: generate an intermediate component using the runtime helper (`_vCWM`).
- Components using `attrs`: always treated as intermediate components.

This mirrors the general styled behavior (local inlining; exported component wrappers) while preserving style-flag semantics.

### Example: Component Definition

```tsx
const StyledWithModifiers = styled.div<{
  active: boolean;
  size: 'small' | 'medium' | 'large';
  disabled: boolean;
}>`
  padding: 16px;

  &.active {
    background: blue;
  }

  &.size-small {
    padding: 8px;
  }

  &.size-medium {
    padding: 16px;
  }

  &.size-large {
    padding: 24px;
  }

  &.disabled {
    opacity: 0.5;
  }
`;
```

### Non‑exported: Inline JSX Transform (No Intermediate)

Usage:

```tsx
const usage = (
  <StyledWithModifiers
    data-testid="btn"
    active={isActive}
    size="large"
    disabled={false}
    className="extra"
    {...rest}
  >
    Content
  </StyledWithModifiers>
);
```

Compiles to a native element with computed className using `cx` and without forwarding style-flag props:

```tsx
import { cx } from 'vindur';

const usage = (
  <div
    data-testid="btn"
    className={cx(
      'v1234hash-1', // base class
      isActive && 'v1234hash-active',
      'v1234hash-size-large',
      'extra',
    )}
    {...rest}
  >
    Content
  </div>
);
```

- Removes `active`, `size`, `disabled` props from the DOM element.
- Preserves all non-style-flag props and children.
- Merges user `className` and spread props safely.
- Performs constant folding: drops always-false/true branches (e.g., `disabled={false}` removes its modifier entirely; static unions like `size="large"` emit fixed classes).

Dynamic props example (inline):

```tsx
// Usage with dynamic values
const usageDyn = (
  <StyledWithModifiers
    active={isActive}
    size={currentSize} // 'small' | 'medium' | 'large'
    disabled={isDisabled}
    className={externalClass}
    {...rest}
  />
);

// Generated (no intermediate):
import { cx } from 'vindur';

const usageDyn = (
  <div
    className={cx(
      'v1234hash-1',
      isActive && 'v1234hash-active',
      currentSize && `v1234hash-size-${currentSize}`,
      isDisabled && 'v1234hash-disabled',
      externalClass,
      // plus any className coming from spread props
    )}
    {...rest}
  />
);
```

### Exported: Intermediate Component

When the styled component is exported (or has `attrs`), generate an intermediate component that applies modifier classes at runtime:

```tsx
const StyledWithModifiers = _vCWM(
  [
    ['active', 'v1234hash-active'],
    ['size', 'v1234hash-size'],
    ['disabled', 'v1234hash-disabled'],
  ],
  'v1234hash-1',
  'div',
  /* optional attrs */
);

// Can be used as a normal JSX component
const usage = (
  <StyledWithModifiers
    active={true}
    size="large"
    disabled={false}
  >
    Content
  </StyledWithModifiers>
);
```

Dynamic props example (exported):

```tsx
// Usage (component stays as a single intermediate wrapper)
const usageDyn = (
  <StyledWithModifiers
    active={isActive}
    size={currentSize}
    disabled={isDisabled}
    className={externalClass}
    {...rest}
  />
);

// _vCWM computes the appropriate modifier classes at runtime;
// no extra transform at call site is required.
```

### Generated CSS

The CSS output includes both base styles and modifier classes with hashed names:

```css
.v1234hash-1 {
  padding: 16px;

  &.v1234hash-active {
    background: blue;
  }

  &.v1234hash-size-small {
    padding: 8px;
  }

  &.v1234hash-size-medium {
    padding: 16px;
  }

  &.v1234hash-size-large {
    padding: 24px;
  }

  &.v1234hash-disabled {
    opacity: 0.5;
  }
}
```

## Class Application Logic

### Boolean Props

- **When `true`**: Apply the hashed class name
- **When `false`**: Do not apply any class

```tsx
<StyledWithModifiers active={true} />
// Result: className="v1234hash-1 v1234hash-active"

<StyledWithModifiers active={false} />
// Result: className="v1234hash-1"
```

### String Union Props

- **When prop value matches a union member**: Apply the hashed class with value suffix
- **When prop value doesn't match**: Do not apply any class

```tsx
<StyledWithModifiers size="large" />
// Result: className="v1234hash-1 v1234hash-size-large"

<StyledWithModifiers size="small" />
// Result: className="v1234hash-1 v1234hash-size-small"
```

## CSS Selector Patterns

### Boolean Props

```css
&.propName {
  /* Styles applied when propName={true} */
}
```

### String Union Props

```css
&.propName-value {
  /* Styles applied when propName="value" */
}
```

The CSS selectors are automatically transformed during compilation:

- `&.active` becomes `&.v1234hash-active`
- `&.size-small` becomes `&.v1234hash-size-small`
- `&.size-large` becomes `&.v1234hash-size-large`

## Integration with Other Features

### With Existing className

```tsx
const usage = (
  <StyledWithModifiers
    active={true}
    size="medium"
    className="extra-class"
  >
    Content
  </StyledWithModifiers>
);

// Result (non-export inline): className="v1234hash-1 v1234hash-active v1234hash-size-medium extra-class"
// Result (exported component): identical className merging via _vCWM
```

### With Spread Props

```tsx
const usage = (
  <StyledWithModifiers
    active={true}
    size="large"
    {...props}
  >
    Content
  </StyledWithModifiers>
);

// Spread props merge as usual. Style-flag props are not forwarded to DOM.
```

### With Dynamic Values

```tsx
const usage = (
  <StyledWithModifiers
    active={isActive}
    size={currentSize}
    disabled={isDisabled}
  >
    Content
  </StyledWithModifiers>
);

// Runtime evaluation of prop values determines which modifier classes are applied
// For non-exported components this is compiled inline using cx(); for exported via _vCWM
```

### With withComponent

- Non-exported: usages are rewritten to the new element type with inline `cx` class computation.
- Exported: `_vCWM` receives the new element/component reference.

## Supported Property Types

### Boolean Properties

- **Type**: `propName: boolean`
- **CSS Selector**: `&.propName`
- **Generated Class**: `{hash}-propName`
- **Applied When**: `propName={true}`

### String Literal Unions

- **Type**: `propName: 'value1' | 'value2' | 'value3'`
- **CSS Selectors**: `&.propName-value1`, `&.propName-value2`, `&.propName-value3`
- **Generated Classes**: `{hash}-propName-value1`, `{hash}-propName-value2`, etc.
- **Applied When**: `propName="value1"`, `propName="value2"`, etc.

## Error Handling

### Unsupported Property Types

```tsx
// This should throw a compilation error
const StyledWithModifiers = styled.div<{
  count: number; // Not supported
  callback: () => void; // Not supported
  data: { key: string }; // Not supported
}>`
  &.active { ... }
`;
```

**Error**: `Style flags only support boolean properties and string literal unions. Property "count" has type "number".`

### Mixed Union Types

```tsx
// This should throw a compilation error
const StyledWithModifiers = styled.div<{
  mixed: 'small' | 42 | boolean; // Mixed types not supported
}>`
  &.active { ... }
`;
```

**Error**: `Style flags only support boolean properties and string literal unions. Property "mixed" has type "small" | 42 | boolean.`

### Missing Modifier Styles

```tsx
// This should issue a warning if no corresponding CSS selector exists
const StyledWithModifiers = styled.div<{
  active: boolean;
  size: 'small' | 'large';
}>`
  padding: 16px;
  // Missing: &.active, &.size-small, &.size-large selectors
`;
```

_Note: Warning implementation may vary based on development vs production builds_

## Rationale & Performance

- Avoids creating component wrappers for local-only usage, reducing call depth and React work.
- Keeps exported API stable by using a single generated component for consumers.
- Maintains identical CSS output and class hashing regardless of export status.
