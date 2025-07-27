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
    className="v-hash-1 final"
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
    className={mergeClassNames(['before', props], 'v-hash-1')}
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
    className={mergeClassNames([props1, props2], 'v-hash-1 final')}
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

const compiled = <button className={`${color.__scn('#ff6b6b')} base-class`} />;
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
    className={`${color1.__scn('#ff6b6b')} ${color2.__scn('#ff6b6b')}`}
    style={{ ...color1.__st('#ff6b6b'), ...color2.__st('#ff6b6b') }}
  />
);
```
