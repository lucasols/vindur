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

### 🚧 **CSS Extension**

- [x] CSS style interpolation with semicolon extension
- [x] CSS selector usage in styled components used as a selector

### ✅ **Advanced Styling**

- [x] Global styles via `createGlobalStyle` ✅
- [x] CSS keyframes via `keyframes` function (like `styled-components`) ✅
- [x] Theme/color utilities ✅
  - [x] Static colors ✅

### 🚧 **JSX Props**

- [x] JSX `css` prop (styled-components/emotion style) ✅
- [x] JSX `cx` prop (classnames style) ✅
  ```tsx
  <div cx={{ active: true, disabled: false }} />
  ```

### 🚧 **Dynamic Features**

- [x] Dynamic CSS colors
- [ ] Style flags props

  ```tsx
  const StyledWithModifier = styled.div<{
    active: boolean
    disabled: boolean
  }>`
    &.active { ... }
    &.disabled { ... }
  `

  <StyledWithModifier active={true} disabled={false} />
  ```

  in output the Variable will be replaced with the following and used as a normal JSX component, no css injection in jsx in this case:

  ```tsx
  const StyledWithModifier = vComponentWithModifiers(
    ['active', 'disabled'],
    'vHash-1', // generated css will be injected here
  );
  ```

### DX

- [ ] Stylelint plugin

### 🚧 **Utility Features**

- [x] Stable IDs via `stableId` function

### 🚧 **Scoping System**

- [ ] Scoped JSX modifier classes (prefix with `_`)
- [ ] Scoped CSS variables (`---var` syntax)

## Beta 2 - Advanced Features

- [ ] `withComponent` or something similar to change styled component tags
- [ ] `styled.div.attrs` support or something similar to create components with predefined props
- [x] Variable interpolation from external files
- [ ] Cross-module styled component references
- [ ] CSS layers for conflict resolution
- [ ] Atomic styles generation
- [ ] CSS output caching
- [ ] Light/dark mode support

## Developer Experience

- [ ] Error handling improvements

---

## Legend

- ✅ **Completed** - Feature is implemented and tested
- 🚧 **In Progress** - Feature is planned for current beta
- 🔮 **Future** - Feature planned for later releases
