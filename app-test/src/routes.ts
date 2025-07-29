import { CssPropDemo } from './demos/CssPropDemo';
import { CssTaggedTemplateDemo } from './demos/CssTaggedTemplateDemo';
import { CxPropDemo } from './demos/CxPropDemo';
import { DynamicColorsDemo } from './demos/DynamicColorsDemo';
import { GlobalStyleDemo } from './demos/GlobalStyleDemo';
import { KeyframesDemo } from './demos/KeyframesDemo';
import { ScopedVariablesDemo } from './demos/ScopedVariablesDemo';
import { StyledComponentsDemo } from './demos/StyledComponentsDemo';
import { StyleFlagsDemo } from './demos/StyleFlagsDemo';
import { VindurFnDemo } from './demos/VindurFnDemo';

export const demos = [
  { path: '/', name: 'CSS Tagged Templates', component: CssTaggedTemplateDemo },
  { path: '/styled-components', name: 'Styled Components', component: StyledComponentsDemo },
  { path: '/css-prop', name: 'CSS Prop', component: CssPropDemo },
  { path: '/cx-prop', name: 'CX Prop', component: CxPropDemo },
  { path: '/vindur-fn', name: 'VindurFn', component: VindurFnDemo },
  { path: '/scoped-variables', name: 'Scoped Variables', component: ScopedVariablesDemo },
  { path: '/keyframes', name: 'Keyframes', component: KeyframesDemo },
  { path: '/style-flags', name: 'Style Flags', component: StyleFlagsDemo },
  { path: '/dynamic-colors', name: 'Dynamic Colors', component: DynamicColorsDemo },
  { path: '/global-styles', name: 'Global Styles', component: GlobalStyleDemo },
];