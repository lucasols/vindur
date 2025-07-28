> Hash values are just examples, they not represent the actual hash values.

# Transform Logic with css prop

## Detection and Validation

1. **Only allow on DOM elements and styled components** - throw error for custom components
2. **Remove css prop** from JSX (it's not a real DOM attribute)

## Template Literal css prop

```tsx
// Direct template literal
const before = (
  <div
    css={`
      background: blue;
      padding: 20px;
    `}
  >
    Content
  </div>
);

const compiled = <div className="v1234hash-css-prop-1">Content</div>;
```

## css Function Reference

```tsx
// Reference to css variable
const styles = css`
  background: red;
`; // → "v1234hash-styles"

const before = <div css={styles}>Content</div>;

const compiled = <div className={styles}>Content</div>;
```

## With Existing className

```tsx
// Merges with existing className
const before = (
  <div
    className="existing"
    css={`
      color: green;
    `}
  >
    Content
  </div>
);

const compiled = <div className="existing v1234hash-css-prop-1">Content</div>;
```

## On Styled Components

```tsx
// Works with styled components
const before = (
  <StyledCard
    css={`
      border: 1px solid red;
    `}
  >
    Content
  </StyledCard>
);

const compiled = (
  <div className="v1234hash-Card v1234hash-css-prop-1">Content</div>
);
```

## css Extension with Interpolation

```tsx
// Can extend other css variables
const baseStyles = css`
  padding: 16px;
`; // → "v1234hash-baseStyles"

const before = (
  <div
    css={`
      ${baseStyles};
      background: white;
    `}
  >
    Content
  </div>
);

const compiled = (
  <div className="v1234hash-baseStyles v1234hash-css-prop-1">Content</div>
);
```

## With spread props

When css prop is combined with spread props, mergeClassNames is used to handle potential className conflicts:

```tsx
const before = (
  <StyledCard
    css={`
      border: 1px solid red;
    `}
    {...props}
  >
    Content
  </StyledCard>
);

const compiled = (
  <div
    {...props}
    className={mergeClassNames([props], 'v1234hash-Card v1234hash-css-prop-1')}
  >
    Content
  </div>
);
```

## css prop after spread props

Order doesn't matter - css prop is always merged with spread props using mergeClassNames:

```tsx
const before = (
  <StyledCard
    {...props}
    css={`
      border: 1px solid red;
    `}
  >
    Content
  </StyledCard>
);

const compiled = (
  <div
    {...props}
    className={mergeClassNames([props], 'v1234hash-Card v1234hash-css-prop-1')}
  >
    Content
  </div>
);
```