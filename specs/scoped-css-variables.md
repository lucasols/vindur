> Hash values are just examples, they do not represent the actual hash values.

# Scoped CSS Variables Transform Logic

## Overview

Scoped CSS variables provide a way to define CSS custom properties that are automatically scoped to avoid naming conflicts across components. Using the `---var` syntax (triple dash), these variables are processed at compile time to generate unique, scoped variable names while maintaining runtime CSS variable behavior.

## Syntax

Scoped CSS variables use triple-dash syntax to distinguish them from regular CSS custom properties:

```css
/* Scoped variable (processed by Vindur) */
---primary-color: #007bff;
---spacing: 16px;

/* Regular CSS custom property (unchanged) */
--global-font-size: 16px;
```

## Detection and Processing

1. **Identify `---var` declarations** in CSS template literals
2. **Generate scoped variable names** using component/context hashing
3. **Transform usage references** to use the scoped names
4. **Process dynamic style prop variables** with automatic scope hash application

## Transform Examples

### Basic Scoped Variables

**Input:**

```tsx
const Card = styled.div`
  ---primary-color: #007bff;
  ---spacing: 16px;
  ---border-radius: 8px;

  background: var(---primary-color);
  padding: var(---spacing);
  border-radius: var(---border-radius);
  border: 1px solid var(---primary-color);
`;
```

**Output CSS (Development):**

```css
.vhash123-card {
  --vhash123-1-primary-color: #007bff;
  --vhash123-2-spacing: 16px;
  --vhash123-3-border-radius: 8px;

  background: var(--vhash123-1-primary-color);
  padding: var(--vhash123-2-spacing);
  border-radius: var(--vhash123-3-border-radius);
  border: 1px solid var(--vhash123-1-primary-color);
}
```

**Output CSS (Production):**

```css
.vhash123-card {
  --vhash123-1: #007bff;
  --vhash123-2: 16px;
  --vhash123-3: 8px;

  background: var(--vhash123-1);
  padding: var(--vhash123-2);
  border-radius: var(--vhash123-3);
  border: 1px solid var(--vhash123-1);
}
```

### Dynamic Variables with Style Prop

Scoped variables can be set dynamically using the `style` prop. Vindur automatically processes variables with the correct scope hash:

**Input:**

```tsx
const Card = styled.div`
  background: var(---color);
`;

const Component = () => {
  return <Card style={{ '---color': '#007bff' }}>Hello</Card>;
};
```

**Transform Process:**

1. **CSS Processing**: `var(---color)` becomes `var(--vhash123-1)` (production) or `var(--vhash123-1-color)` (development)
2. **Style Prop Processing**: `'---color': '#007bff'` becomes `'--vhash123-1': '#007bff'` (production) or `'--vhash123-1-color': '#007bff'` (development)

**Output CSS (Development):**

```css
.vhash123-card {
  background: var(--vhash123-1-color);
}
```

**Output CSS (Production):**

```css
.vhash123-card {
  background: var(--vhash123-1);
}
```

**Output JSX (Development):**

```tsx
const Component = () => {
  return <Card style={{ '--vhash123-1-color': '#007bff' }}>Hello</Card>;
};
```

**Output JSX (Production):**

```tsx
const Component = () => {
  return <Card style={{ '--vhash123-1': '#007bff' }}>Hello</Card>;
};
```

## Variable Name Generation

### Production Format

- **Pattern**: `--{scopeHash}-{index}`
- **Example**: `var(---primary-color)` → `var(--vhash123-1)`
- **Style Prop**: `'---primary-color': value` → `'--vhash123-1': value`

### Development Format

- **Pattern**: `--{scopeHash}-{index}-{varName}`
- **Example**: `var(---primary-color)` → `var(--vhash123-1-primary-color)`
- **Style Prop**: `'---primary-color': value` → `'--vhash123-1-primary-color': value`

### Index Assignment

Variables are assigned incrementally based on their order of appearance in the CSS:

```tsx
const Card = styled.div`
  ---primary-color: #007bff; // index 1
  ---spacing: 16px; // index 2
  ---border-radius: 8px; // index 3
`;
```

### Variable Resolution

All instances of the same variable name within a component scope resolve to the same index:

```tsx
const Card = styled.div`
  ---color: #007bff;
  background: var(---color); // Both resolve to same index
  border: 1px solid var(---color);
`;
```

## Scoping Rules

### Component-Level Scoping

Variables are scoped to the file where they are declared:

```tsx
const ButtonA = styled.button`
  ---button-color: red;
  background: var(---button-color);
`;

const ButtonB = styled.button`
  ---button-color: blue; // Same scope, same generated hash
  background: var(---button-color);
`;
```

### Style Prop Scoping

Variables in style props are automatically scoped to match the component:

```tsx
const Button = styled.button`
  background: var(---color);    // becomes --vhash123-1 (prod) or --vhash123-1-color (dev)
  color: var(---text);          // becomes --vhash123-2 (prod) or --vhash123-2-text (dev)
`;

// Both variables are scoped to the same component
// Development
<Button style={{
  '--vhash123-1-color': '#007bff',
  '--vhash123-2-text': 'white'
}}>
  Click me
</Button>

// Production
<Button style={{
  '--vhash123-1': '#007bff',
  '--vhash123-2': 'white'
}}>
  Click me
</Button>
```

## Validation and Warnings

### Declared but Not Read Variables

Variables that are declared but never used will generate a console warning at compile time in development:

```tsx
// ⚠️ Console warning: Scoped variable '---unused-color' is declared but never read
const Card = styled.div`
  ---primary-color: #007bff;
  ---unused-color: #ff0000; // Declared but never used

  background: var(---primary-color);
`;
```

### Read but Not Declared Variables

Variables that are used but never declared will generate a console warning at compile time in development:

```tsx
// ⚠️ Console warning: Scoped variable '---unknown-color' is used but never declared
const Card = styled.div`
  ---primary-color: #007bff;

  background: var(---primary-color);
  border: 1px solid var(---unknown-color); // Used but never declared
`;
```

### Style Prop Validation

Setting variables in style props that don't correspond to declared variables will generate warnings:

```tsx
const Card = styled.div`
  ---color: #007bff;
  background: var(---color);
`;

// ⚠️ Console warning: Css variable '---unknown' is not used in the file
<Card style={{ '---unknown': 'value' }}>Content</Card>;
```
