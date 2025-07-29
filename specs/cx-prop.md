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

**Each cx prop usage gets unique hash indices**, ensuring proper isolation between different elements. Class names are assigned incremental indices based on their order of appearance in the file, shared with all other Vindur hash-generating features:

```tsx
// css`` gets index 1
const baseStyles = css`
  background: red;
`;

// Button styled component gets index 2
const Button = styled.button`
  padding: 8px;
  
  &.active { background: blue; }
  &.disabled { opacity: 0.5; }
`;

// Card styled component gets index 3
const Card = styled.div`
  border: 1px solid #ddd;
  
  &.active { border-color: gold; }
  &.disabled { background: #f5f5f5; }
`;

// Button cx: active gets index 4, disabled gets index 5
const ButtonElement = <Button cx={{ active: isActive, disabled: isDisabled }} />;

// Card cx: active gets index 6, disabled gets index 7 (unique from Button)
const CardElement = <Card cx={{ active: cardActive, disabled: cardDisabled }} />;

// DOM element with css prop: active gets index 8
const DivElement = (
  <div cx={{ active: divActive }} css={`
    &.active { background: yellow; }
  `} />
);

// Another DOM element: active gets index 9 (unique from previous)
const AnotherDiv = <div cx={{ active: anotherActive }} css={`
  &.active { background: green; }
`} />;
```

This ensures that:
- **Each element's modifiers are isolated** - `Button.active` vs `Card.active` vs `div.active` all get different hashes
- **CSS conflicts are prevented** - Different elements can have different styling for the same modifier name
- **Bundle optimization** - Each hash is used exactly where it's needed

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

Class names are scoped at the file level, with indices shared across all Vindur features. **Each cx prop usage gets a unique hash index**, ensuring proper isolation:

```tsx
// file1.tsx
const styles = css`
  background: red;
`; // v1234hash-1

const Button = styled.button`
  color: blue;
`; // v1234hash-2

const Card = styled.div`
  border: 1px solid #ddd;
`; // v1234hash-3

// Each cx usage gets unique indices, even for the same modifier name
const ButtonA = <Button cx={{ active: isActive }} />; // active=v1234hash-4
const ButtonB = <Button cx={{ active: buttonActive, disabled: isDisabled }} />; // active=v1234hash-5, disabled=v1234hash-6

const CardA = <Card cx={{ active: cardActive }} />; // active=v1234hash-7 (unique from Button.active!)
const CardB = <Card cx={{ disabled: cardDisabled }} />; // disabled=v1234hash-8 (unique from Button.disabled!)

// DOM elements with CSS context also get unique indices
const DivA = <div cx={{ active: divActive }} css={`&.active { color: red; }`} />; // active=v1234hash-9
const DivB = <div cx={{ active: anotherActive }} css={`&.active { color: blue; }`} />; // active=v1234hash-10

// file2.tsx - new file resets the counter
const AnotherButton = <Button cx={{ active: isActive }} />; // v5678hash-1 (different file)
```

### Variable Name Format

- **Production**: `{scopeHash}-{index}`
- **Development**: `{scopeHash}-{index}-{className}`

**Every cx prop usage gets a unique index**, ensuring complete isolation between different elements. This prevents CSS conflicts and allows different elements to style the same modifier name differently.
