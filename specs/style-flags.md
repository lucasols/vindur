> Hash values are just examples, they not represent the actual hash values.

# Style Flags Transform Logic

## Overview

Style flags allow styled components to accept boolean props that automatically apply modifier classes. This enables conditional styling through prop-based class application. It is similar to the [`cx` prop](cx-prop.md) behavior as the props are also hashed.

## Detection and Validation

1. **Only apply to styled components** - not for regular DOM elements
2. **Extract type information** from styled component generic type parameters
3. **Identify boolean properties** in the component's prop type
4. **Generate modifier classes** for each boolean prop

## Component Definition

```tsx
const StyledWithModifier = styled.div<{
  active: boolean;
  disabled: boolean;
}>`
  padding: 16px;

  &.active {
    background: blue;
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
const StyledWithModifier = styled.div<{
  active: boolean;
  disabled: boolean;
}>`
  padding: 16px;

  &.active {
    background: blue;
  }

  &.disabled {
    opacity: 0.5;
  }
`;

// will be transformed to:
const StyledWithModifier = vComponentWithModifiers(
  [
    ['active', 'v1234hash-active'], // prop name and class name
    ['disabled', 'v1234hash-disabled'], // prop name and class name
  ],
  'v1234hash-1',
);

// Component can be used as a normal JSX component
// Internal implementation handles modifier class application
const usage = (
  <StyledWithModifier
    active={true}
    disabled={false}
  >
    Content
  </StyledWithModifier>
);
```

### Generated CSS

The CSS output includes both base styles and modifier classes:

```css
.v1234hash-1 {
  padding: 16px;

  &.v1234hash-active {
    background: blue;
  }

  &.v1234hash-disabled {
    opacity: 0.5;
  }
}
```

## Integration with Other Features

### With Existing className

```tsx
const usage = (
  <StyledWithModifier
    active={true}
    className="extra-class"
  >
    Content
  </StyledWithModifier>
);

// Internally merges: base class + modifier classes + extra className
```

### With Spread Props

```tsx
const usage = (
  <StyledWithModifier
    active={true}
    {...props}
  >
    Content
  </StyledWithModifier>
);

// Internally handles merging of spread props with modifier classes
```

### With Dynamic Values

```tsx
const usage = (
  <StyledWithModifier
    active={isActive}
    disabled={isDisabled}
  >
    Content
  </StyledWithModifier>
);

// Runtime evaluation of boolean props determines which modifier classes are applied
```

## Error Handling

### Non-boolean Types

```tsx
// This should throw a compilation error
const StyledWithModifier = styled.div<{
  status: 'active' | 'inactive'; // Not boolean
}>`
  &.active { ... }
`;
```

### Missing Modifier Styles

```tsx
// This should throw a warning if no corresponding CSS selector exists
const StyledWithModifier = styled.div<{
  active: boolean;
}>`
  padding: 16px;
  // Missing: &.active selector
`;
```
