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
  <button
    {...props}
    className="final"
  />
);

const compiled = (
  <button
    {...props}
    className="vHash-1 final"
  />
);
```

### Spreads after className

If the className comes before the spread, it may or not be override by the spread className. So in this case we need to use the merge util

```tsx
const before = (
  <button
    className="before"
    {...props}
  />
);

const compiled = (
  <button
    {...props}
    className={mergeClassNames(['before', props], 'vHash-1')}
  />
);
```

## Transform Logic with multiple spreads

```tsx
const before = (
  <button
    {...props1}
    {...props2}
    className="final"
  />
);

const compiled = (
  <button
    {...props1}
    {...props2}
    className={mergeClassNames([props1, props2], 'vHash-1 final')}
  />
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

- The `color.__scn` (set class name) will be added as a spread attribute to add the className to the button
- The `color.__st` (set style) will be added as a spread attribute to add the style to the button

```tsx
const before = <Button dynamicColor={color} />;

const compiled = (
  <button
    className={color.__scn('#ff6b6b')}
    style={color.__st('#ff6b6b')}
  />
);
```

### With already existing className

```tsx
const before = (
  <button
    dynamicColor={color}
    className="base-class"
  />
);

const compiled = (
  <button className={`${color.__scn('#ff6b6b')} base-class vHash-1`} />
);
```

### With already existing style

```tsx
const before = (
  <button
    dynamicColor={color}
    style={{ backgroundColor: 'red' }}
  />
);

const compiled = (
  <button
    className={color.__scn('#ff6b6b')}
    style={{ backgroundColor: 'red', ...color.__st('#ff6b6b') }}
  />
);
```

### Multiple Dynamic Colors

```tsx
const before = <button dynamicColor={[color1, color2]} />;

const compiled = (
  <button
    className={`${color1.__scn('#ff6b6b')} ${color2.__scn('#ff6b6b')} vHash-1`}
    style={{ ...color1.__st('#ff6b6b'), ...color2.__st('#ff6b6b') }}
  />
);
```

### With spread props

When spread props are used with dynamicColor, the potential className and style from the spread should be merged with the dynamicColor props.
This will be done with a merge util specific to this case (mergeClassNamesWithDynamicColor and mergeStyles)

```tsx
const input = (
  <button
    dynamicColor={color}
    {...props}
  />
);

// className and style must be added as the last props as they cannot be overridden by other props
const compiled = (
  <button
    {...props}
    className={mergeClassNamesWithDynamicColor([props], 'vHash-1', [
      color.__scn('#ff6b6b'),
    ])}
    style={mergeStyles([props, color.__st('#ff6b6b')])}
  />
);
```

### Multiple spread props

```tsx
const input = (
  <button
    dynamicColor={color}
    {...props1}
    {...props2}
  />
);

const compiled = (
  <button
    {...props1}
    {...props2}
    className={mergeClassNamesWithDynamicColor([props1, props2], 'vHash-1', [
      color.__scn('#ff6b6b'),
    ])}
    style={mergeStyles([props1, props2, color.__st('#ff6b6b')])}
  />
);
```

### className or style after spread

If the className is after the spread, it will override the spread className. So in this case the spread will be ignored in final className

```tsx
const input = (
  <button
    dynamicColor={color}
    {...props}
    className="final"
  />
);

const compiled = (
  <button
    {...props}
    className={`${color.__scn('#ff6b6b')} vHash-1 final`}
  />
);
```

The same logic applies for style.

```tsx
const input = (
  <button
    dynamicColor={color}
    {...props}
    style={{ backgroundColor: 'red' }}
  />
);

const compiled = (
  <button
    {...props}
    style={{ backgroundColor: 'red', ...color.__st('#ff6b6b') }}
  />
);
```
