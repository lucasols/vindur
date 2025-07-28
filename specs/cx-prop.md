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

const compiled = (
  <div
    className={cx({
      'v1234hash-active': isActive,
      'v1234hash-disabled': isDisabled,
    })}
  />
);
```

## Class Name Hashing

### Default Behavior (Hashed Classes)

By default, class names are hashed for bundle size optimization:

```tsx
const before = <div cx={{ active: isActive }} />;

const compiled = <div className={cx({ 'v1234hash-active': isActive })} />;
```

### Preventing Hashing with $ Prefix

Use `$` prefix to prevent class name hashing. The `$` prefix is removed from the final class name:

```tsx
// $ prefix prevents hashing and is removed from final class name
const before = <div cx={{ $noHash: true, active: isActive }} />;

const compiled = (
  <div className={cx({ noHash: true, 'v1234hash-active': isActive })} />
);
```

## Integration with Other Props

### With Existing className

The `cx` prop merges with existing `className` attributes by combining them in the final className:

```tsx
const before = (
  <div
    className="existing-class"
    cx={{ active: isActive }}
  />
);

const compiled = (
  <div className={'existing-class ' + cx({ 'v1234hash-active': isActive })} />
);
```

### With css prop

Combines seamlessly with the `css` prop by merging generated CSS classes:

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
    className={'v1234hash-css-prop-1 ' + cx({ 'v1234hash-active': isActive })}
  />
);
```

### With dynamicColor prop

Works together with dynamic color properties by merging into the final className:

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
      className: cx({ 'v1234hash-active': isActive }),
    })}
  />
);
```

### With Spread Props

When combined with spread props, mergeClassNames handles potential conflicts:

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
    className={mergeClassNames([props], cx({ 'v1234hash-active': isActive }))}
  />
);
```

### Complex Integration

All props can be combined together, with proper merging of all className sources:

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
        'base-class v1234hash-css-prop-1',
        cx({ 'v1234hash-active': isActive, 'v1234hash-disabled': isDisabled }),
      ),
    })}
  />
);
```

## Runtime Helper Function

The `cx` helper function is imported from `vindur` and evaluates dynamic conditions at runtime:

```tsx
import { cx } from 'vindur';

// Example usage in compiled output
const dynamicClassName = cx({
  'v1234hash-active': isActive,
  'v1234hash-disabled': isDisabled,
  noHash: true, // $ prefix was removed
});
```