> Hash values are just examples, they not represent the actual hash values.

# Spread Props Compilation With Class Name Injection

## Validation

- Only allow spread of variables, throw error for complex expressions like `{...(condition && props)}` or inline spread objects like `{...{ className: 'base-class' }}`

## Key Assumptions

- All spread objects are considered to potentially have a className attribute
- Merging is only done if really needed
- The final merging will be done with a merge util (mergeClassNames) at runtime

## Transform Logic with className prop

### Class name after the spread

If there is a className after the spread, it will override the spread className. So in this case there is no need to use the merge util

```tsx
const before = (
  <StyledButton
    {...props}
    className="final"
  />
);

const compiled = (
  <button
    {...props}
    className="v1234hash-1 final"
  />
);
```

### Spreads after className

If the className comes before the spread, it may or not be override by the spread className. So in this case we need to use the merge util

```tsx
const before = (
  <StyledButton
    className="before"
    {...props}
  />
);

const compiled = (
  <button
    {...props}
    className={mergeClassNames(['before', props], 'v1234hash-1')}
  />
);
```

## Transform Logic with multiple spreads

### Multiple spreads with final className

```tsx
const before = (
  <StyledButton
    {...props1}
    {...props2}
    className="final"
  />
);

const compiled = (
  <button
    {...props1}
    {...props2}
    className="v1234hash-1 final"
  />
);
```

### Multiple spreads without final className

```tsx
const before = (
  <StyledButton
    {...props1}
    {...props2}
  />
);

const compiled = (
  <button
    {...props1}
    {...props2}
    className={mergeClassNames([props1, props2], 'v1234hash-1')}
  />
);
```

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

# Handling dynamicColor props

## Detection and Removal

1. **Find dynamicColor attribute** in JSX element
2. **Remove the attribute** from JSX (it's not a real DOM attribute)
3. **Extract the color identifier** from the attribute value

## Transform Logic

### Single Dynamic Color

When using dynamicColor:

- The `color._sp` (set props) function will be added to set className and style attribute

```tsx
type _sp = (
  color: string | null | false | undefined,
  mergeWith: {
    className: string;
    style: Record<string, unknown>;
  },
) => {
  className: string;
  style?: Record<string, unknown>;
};
```

```tsx
const before = <StyledButton dynamicColor={color.set('#ff6b6b')} />;

const compiled = (
  <button {...color._sp('#ff6b6b', { className: 'v1234hash-1' })} />
);
```

### With already existing className

```tsx
const before = (
  <StyledButton
    dynamicColor={color.set('#ff6b6b')}
    className="base-class"
  />
);

const compiled = (
  <button {...color._sp('#ff6b6b', { className: 'v1234hash-1 base-class' })} />
);
```

### With already existing style

```tsx
const before = (
  <StyledButton
    dynamicColor={color.set('#ff6b6b')}
    style={{ backgroundColor: 'red' }}
  />
);

const compiled = (
  <button
    {...color._sp('#ff6b6b', {
      className: 'v1234hash-1',
      style: { backgroundColor: 'red' },
    })}
  />
);
```

### Multiple Dynamic Colors

Multiple dynamic colors require combining their outputs with the `_sp` merge argument. Only the last `_sp` call will merge the className and style.

```tsx
const before = (
  <StyledButton dynamicColor={[color1.set('#ff6b6b'), color2.set('#ff6b6b')]} />
);

const compiled = (
  <button
    {...color1._sp(
      '#ff6b6b',
      color2._sp('#ff6b6b', { className: 'v1234hash-1' }),
    )}
  />
);
```

### With spread props

When spread props are used with dynamicColor, the potential className and style from the spread should be merged with the dynamicColor props.

```tsx
const input = (
  <StyledButton
    dynamicColor={color.set('#ff6b6b')}
    {...props}
  />
);

// The _sp method handles merging with spread props
const compiled = (
  <button
    {...props}
    {...color._sp('#ff6b6b', {
      className: mergeClassNames([props], 'v1234hash-1'),
      style: mergeStyles([props]),
    })}
  />
);
```

### Multiple spread props

```tsx
const input = (
  <StyledButton
    dynamicColor={color.set('#ff6b6b')}
    {...props1}
    {...props2}
  />
);

const compiled = (
  <button
    {...props1}
    {...props2}
    {...color._sp('#ff6b6b', {
      className: mergeClassNames([props1, props2], 'v1234hash-1'),
      style: mergeStyles([props1, props2]),
    })}
  />
);
```

### className or style after spread

If the className is after the spread, it will override the spread className. So in this case the spread will be ignored in final className

```tsx
const input = (
  <StyledButton
    dynamicColor={color.set('#ff6b6b')}
    {...props}
    className="final"
  />
);

const compiled = (
  <button
    {...props}
    {...color._sp('#ff6b6b', { className: 'final' })}
  />
);
```

The same logic applies for style.

```tsx
const input = (
  <StyledButton
    dynamicColor={color.set('#ff6b6b')}
    {...props}
    style={{ backgroundColor: 'red' }}
  />
);

const compiled = (
  <button
    {...props}
    {...color._sp('#ff6b6b', {
      className: 'v1234hash-1',
      style: { backgroundColor: 'red' },
    })}
  />
);
```

## Conditional set

Condition should be handled inside the set function.

```tsx
const input = (
  <StyledButton dynamicColor={color.set(condition ? '#ff6b6b' : null)} />
);

const compiled = (
  <button
    {...color._sp(condition ? '#ff6b6b' : null, {
      className: 'v1234hash-1',
    })}
  />
);
```

Using condition outside the set function will throw an error.

```tsx
const input = (
  // This will throw an error
  <StyledButton dynamicColor={condition ? color.set('#ff6b6b') : null} />
);
```

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
