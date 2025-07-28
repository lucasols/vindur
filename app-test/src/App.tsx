import '#src/globalStyles';
import { MainLayout } from './components/MainLayout';
import { CssPropDemo } from './demos/CssPropDemo';
import { CssTaggedTemplateDemo } from './demos/CssTaggedTemplateDemo';
import { CxPropDemo } from './demos/CxPropDemo';
import { KeyframesDemo } from './demos/KeyframesDemo';
import { ScopedVariablesDemo } from './demos/ScopedVariablesDemo';
import { StyledComponentsDemo } from './demos/StyledComponentsDemo';
import { VindurFnDemo } from './demos/VindurFnDemo';

function App() {
  return (
    <MainLayout>
      <CssTaggedTemplateDemo />
      <StyledComponentsDemo />
      <CssPropDemo />
      <CxPropDemo />
      <VindurFnDemo />
      <ScopedVariablesDemo />
      <KeyframesDemo />
    </MainLayout>
  );
}

export default App;
