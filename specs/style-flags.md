> Hash values are just examples, they not represent the actual hash values.

# Style Flags Transform Logic

## Overview

Style flags allow styled components to accept boolean props and string union props that automatically apply modifier classes. This enables conditional styling through prop-based class application. The props are automatically hashed for optimal bundle size.

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

### Basic Usage

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

// will be transformed to:
const StyledWithModifiers = vComponentWithModifiers(
  [
    ['active', 'v1234hash-active'], // boolean prop
    ['size', 'v1234hash-size'], // string union prop
    ['disabled', 'v1234hash-disabled'], // boolean prop
  ],
  'v1234hash-1',
  'div',
);

// Component can be used as a normal JSX component
// Internal implementation handles modifier class application
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

// Internally merges: base class + modifier classes + extra className
// Result: className="v1234hash-1 v1234hash-active v1234hash-size-medium extra-class"
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

// Internally handles merging of spread props with modifier classes
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
```

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
