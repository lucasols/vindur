> Hash values are just examples, they not represent the actual hash values.

# Transform Logic with cx prop

## Detection and Validation

1. **Only allow on DOM elements and styled components** - throw error for custom components
2. **Remove cx prop** from JSX (it's not a real DOM attribute)
3. **Only allow object expressions** - throw error for non-object values

## Object-based Conditional Classes

The `cx` prop accepts an object where keys are class names and values are boolean conditions. The prop is completely removed and transformed into a `className` attribute with a `cx()` function call.

```tsx
import { cx } from 'vindur';

const before = <div cx={{ active: isActive, disabled: isDisabled }} />;

// Development
const compiled = (
  <div
    className={cx({
      'v1234hash-1-active': isActive,
      'v1234hash-2-disabled': isDisabled,
    })}
  />
);

// Production
const compiled = (
  <div
    className={cx({
      'v1234hash-1': isActive,
      'v1234hash-2': isDisabled,
    })}
  />
);
```

## Class Name Hashing

### Default Behavior (Hashed Classes)

By default, class names are hashed using file-level scoping with incremental indices:

**Development:**

```tsx
const before = <div cx={{ active: isActive }} />;

const compiled = <div className={cx({ 'v1234hash-1-active': isActive })} />;
```

**Production:**

```tsx
const before = <div cx={{ active: isActive }} />;

const compiled = <div className={cx({ 'v1234hash-1': isActive })} />;
```

### Index Assignment

Class names are assigned incremental indices based on their order of appearance in the file, shared with all other Vindur hash-generating features:

```tsx
// css`` gets index 1
const baseStyles = css`
  background: red;
`;

// cx prop: active gets index 2, disabled gets index 3
const ComponentA = <div cx={{ active: isActive, disabled: isDisabled }} />;

// styled component gets index 4
const Button = styled.button`
  color: blue;
`;

// scoped CSS variable gets index 5
const Card = styled.div`
  ---spacing: 16px;
  padding: var(---spacing);
`;

// cx prop: active reuses index 2, loading gets index 6
const ComponentB = <div cx={{ active: isActive, loading: isLoading }} />;
```

### Preventing Hashing with $ Prefix

Use `$` prefix to prevent class name hashing. The `$` prefix is removed from the final class name:

```tsx
// $ prefix prevents hashing and is removed from final class name
// Development
const before = <div cx={{ $noHash: true, active: isActive }} />;

const compiled = (
  <div className={cx({ noHash: true, 'v1234hash-1-active': isActive })} />
);

// Production
const compiled = (
  <div className={cx({ noHash: true, 'v1234hash-1': isActive })} />
);
```

## Integration with Other Props

### With Existing className

The `cx` prop merges with existing `className` attributes by combining them in the final className:

**Development:**

```tsx
const before = (
  <div
    className="existing-class"
    cx={{ active: isActive }}
  />
);

const compiled = (
  <div className={'existing-class ' + cx({ 'v1234hash-1-active': isActive })} />
);
```

**Production:**

```tsx
const compiled = (
  <div className={'existing-class ' + cx({ 'v1234hash-1': isActive })} />
);
```

### With css prop

Combines seamlessly with the `css` prop by merging generated CSS classes:

**Development:**

```tsx
const before = (
  <div
    cx={{ active: isActive }}
    css={`
      background: red;
    `}
  />
);

const compiled = (
  <div
    className={
      'v1234hash-css-1-background ' + cx({ 'v1234hash-1-active': isActive })
    }
  />
);
```

**Production:**

```tsx
const compiled = (
  <div className={'v1234hash-css-1 ' + cx({ 'v1234hash-1': isActive })} />
);
```

### With dynamicColor prop

Works together with dynamic color properties by merging into the final className:

**Development:**

```tsx
const before = (
  <div
    cx={{ active: isActive }}
    dynamicColor={color.set('#ff6b6b')}
  />
);

const compiled = (
  <div
    {...color._sp('#ff6b6b', {
      className: cx({ 'v1234hash-1-active': isActive }),
    })}
  />
);
```

**Production:**

```tsx
const compiled = (
  <div
    {...color._sp('#ff6b6b', {
      className: cx({ 'v1234hash-1': isActive }),
    })}
  />
);
```

### With Spread Props

When combined with spread props, mergeClassNames handles potential conflicts:

**Development:**

```tsx
const before = (
  <div
    cx={{ active: isActive }}
    {...props}
  />
);

const compiled = (
  <div
    {...props}
    className={mergeClassNames([props], cx({ 'v1234hash-1-active': isActive }))}
  />
);
```

**Production:**

```tsx
const compiled = (
  <div
    {...props}
    className={mergeClassNames([props], cx({ 'v1234hash-1': isActive }))}
  />
);
```

### Complex Integration

All props can be combined together, with proper merging of all className sources:

**Development:**

```tsx
const before = (
  <div
    className="base-class"
    cx={{ active: isActive, disabled: isDisabled }}
    css={`
      background: red;
    `}
    dynamicColor={color.set('#ff6b6b')}
    {...props}
  />
);

const compiled = (
  <div
    {...props}
    {...color._sp('#ff6b6b', {
      className: mergeClassNames(
        [props],
        'base-class v1234hash-css-1-background',
        cx({
          'v1234hash-1-active': isActive,
          'v1234hash-2-disabled': isDisabled,
        }),
      ),
    })}
  />
);
```

**Production:**

```tsx
const compiled = (
  <div
    {...props}
    {...color._sp('#ff6b6b', {
      className: mergeClassNames(
        [props],
        'base-class v1234hash-css-1',
        cx({ 'v1234hash-1': isActive, 'v1234hash-2': isDisabled }),
      ),
    })}
  />
);
```

## Runtime Helper Function

The `cx` helper function is imported from `vindur` and evaluates dynamic conditions at runtime:

**Development:**

```tsx
import { cx } from 'vindur';

// Example usage in compiled output
const dynamicClassName = cx({
  'v1234hash-1-active': isActive,
  'v1234hash-2-disabled': isDisabled,
  noHash: true, // $ prefix was removed
});
```

**Production:**

```tsx
import { cx } from 'vindur';

// Example usage in compiled output
const dynamicClassName = cx({
  'v1234hash-1': isActive,
  'v1234hash-2': isDisabled,
  noHash: true, // $ prefix was removed
});
```

## Scoping and Index Assignment

### File-Level Scoping

Class names are scoped at the file level, with indices shared across all Vindur features:

```tsx
// file1.tsx
const styles = css`
  background: red;
`; // v1234hash-1
const ComponentA = <div cx={{ active: isActive }} />; // v1234hash-2
const Button = styled.button`
  color: blue;
`; // v1234hash-3
const ComponentB = <div cx={{ disabled: isDisabled }} />; // v1234hash-4

// file2.tsx
const ComponentC = <div cx={{ active: isActive }} />; // v5678hash-1 (different file, reset counter)
const Card = styled.div`
  ---color: red;
`; // v5678hash-2
const ComponentD = <div cx={{ disabled: isDisabled }} />; // v5678hash-3
```

### Variable Name Format

- **Production**: `{scopeHash}-{index}`
- **Development**: `{scopeHash}-{index}-{className}`

Class names with the same name within a file always resolve to the same index, but the global index counter is shared across all Vindur features:

```tsx
// Assuming previous features used indices 1-5
const Card1 = <div cx={{ active: isActive }} />; // active=6
const Card2 = <div cx={{ loading: isLoading }} />; // loading=7
const Card3 = <div cx={{ active: isActive, error: hasError }} />; // active=6, error=8

// New css`` would get index 9
const newStyles = css`
  margin: 10px;
`;
```
