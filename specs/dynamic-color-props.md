> Hash values are just examples, they not represent the actual hash values.

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