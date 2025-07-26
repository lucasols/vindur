# A css-in-js library with focus in performance

COMING SOON!

# Features

beta 1

- css function
- styled.\* functions
- interpolate string and number vars
- mixins/functions
- no intermediate component generation, classes are injected in the jsx directly
- extend styles `style(Button)`
- reference styled components inside another styled component

```tsx
const Container = styled.div`
  background-color: red;
`

const Button = styled.div`
  ${Container}:hover {
    background-color: blue;
  }
`
```

- interpolate css styles into styled components, if the interpolation is followed by `;` it will extend the styles

```tsx
const baseStyles = css`
  ...
`

const Button = styled.div`
  ${baseStyles};

  ...
`

const Component = () => {
  return <Button />
}
```

output:

```css
.baseStyleClassHash {
  ...
}

.ButtonClassHash {
  ...
}
```

```tsx
const Component = () => {
  return <div className="baseStyleClassHash ButtonClassHash" />
}
```

- use css styles selectors in styled components

```tsx
const baseStyles = css`
  ...
`

const Button = styled.div`
  ${baseStyles} {
  }
`
```

- global styles, via `:global() {}` selector or `createGlobalStyle`
- withComponent
- media queries
- css keyframes
- jsx `cx` prop (like `classnames`)

```tsx
const Component = () => {
  return (
    <div
      cx={{
        active: true,
        disabled: false,
      }}
    />
  )
}
```

- jsx `css` prop (like `styled-components`/`emotion`)
- scoped classes and css variables, will be compiled to hash to avoid collisions
  - scoped jsx modifier classes `_scoped` (used in `cx` prop or `className` prop, or `style flags` props)
  - scoped css variables `---var`
- stable ids
- dynamic css variables
- theme/color utils
- style flags props

```tsx
const StyledWithModifier = styled.div<{
  active: boolean
  disabled: boolean
}>`
  ...

  &.active {
    ...
  }

  &.disabled {
    ...
  }
`

const Component = () => {
  return <StyledWithModifier active disabled={false} />
}
```

- styled.div.attrs support

beta 2

- interpolate variables from another files
- css layers to avoid conflicts
- light/dark mode
- atomic styles
- cache generated css

# devtools

- stylelint plugin

# edge cases

- handle spreading in css component prop
