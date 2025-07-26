# Vindur Roadmap

A compile-time CSS-in-JS library focused on performance.

## Beta 1 - Core Features

### ✅ **Foundation**

- [x] CSS function (`css` tagged template literals)
- [x] Styled component functions (`styled.*`)
- [x] String and number variable interpolation
- [x] Mixins/functions support
- [x] Direct class injection (no intermediate component generation)

### ✅ **Component Composition**

- [x] Style extension (`styled(Button)`)
- [x] Styled component references with `&` selector

```tsx
const Container = styled.div`
  background-color: red;
`

const Button = styled.div`
  ${Container}:hover & {
    background-color: blue;
  }
`
```

### 🚧 **CSS Extension**

- [x] CSS style interpolation with semicolon extension

  ```tsx
  const baseStyles = css`...`
  const Button = styled.div`
    ${baseStyles};
    ...
  `
  ```

- [x] CSS selector usage in styled components used as a selector

  ```tsx
  const baseStyles = css`...`

  const Button = styled.div`
    ${baseStyles} & {
      ...
    }
  `
  ```

### 🚧 **Advanced Styling**

- [x] Global styles via `createGlobalStyle` ✅
- [ ] CSS keyframes via `keyframes` function (like `styled-components`)
- [ ] Theme/color utilities

### 🚧 **JSX Props**

- [ ] JSX `css` prop (styled-components/emotion style)
- [ ] JSX `cx` prop (classnames style)
  ```tsx
  <div cx={{ active: true, disabled: false }} />
  ```

### 🚧 **Dynamic Features**

- [ ] Dynamic CSS variables
- [ ] Style flags props
  ```tsx
  const StyledWithModifier = styled.div<{
    active: boolean
    disabled: boolean
  }>`
    &.active { ... }
    &.disabled { ... }
  `
  ```

### 🚧 **Utility Features**

- [ ] Stable IDs via `stableId` function
- [ ] `withComponent` API
- [ ] `styled.div.attrs` support

### 🚧 **Scoping System**

- [ ] Scoped JSX modifier classes (prefix with `_`)
- [ ] Scoped CSS variables (`---var` syntax)
- [ ] Hash-based collision avoidance

## Beta 2 - Advanced Features

### 🔮 **Cross-File Support**

- [ ] Variable interpolation from external files
- [ ] Cross-module styled component references

### 🔮 **CSS Architecture**

- [ ] CSS layers for conflict resolution
- [ ] Atomic styles generation
- [ ] CSS output caching

### 🔮 **Theming**

- [ ] Light/dark mode support
- [ ] Advanced theme utilities

## Developer Experience

### 🔮 **Tooling**

- [ ] Stylelint plugin
- [ ] TypeScript definitions
- [ ] IDE extensions

### 🔮 **Edge Cases**

- [ ] Spread operator handling in CSS component props
- [ ] Advanced interpolation patterns
- [ ] Error handling improvements

---

## Legend

- ✅ **Completed** - Feature is implemented and tested
- 🚧 **In Progress** - Feature is planned for current beta
- 🔮 **Future** - Feature planned for later releases
