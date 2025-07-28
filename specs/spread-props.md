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