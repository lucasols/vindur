use pretty_assertions::assert_eq;
use vindur_compiler::{Compiler, DiagnosticSeverity, TransformOptions};

#[test]
fn compiles_style_flags_with_oxc_metadata_and_warnings() {
    let source = r#"import { styled } from 'vindur';
const Button = styled.button<{ active: boolean; size: 'small' | 'large' }>`
  color: blue;
  &.active { color: red; }
  &.size-small { padding: 4px; }
`;
const App = ({ active }) => <Button active={active} size="large">Save</Button>;
"#;
    let output = Compiler::new().transform(
        "/test.tsx",
        source,
        &TransformOptions {
            dev: true,
            ..TransformOptions::default()
        },
    );

    assert_eq!(
        output.code,
        "const App = ({ active }) => <button   className={\"v1560qbr-1-Button vr4ikfs-size-large\" + (active ? \" voctcyj-active\" : \"\")}>Save</button>;\n"
    );
    assert_eq!(
        output.css,
        ".v1560qbr-1-Button {\n  color: blue;\n  &.voctcyj-active { color: red; }\n  &.vr4ikfs-size-small { padding: 4px; }\n}"
    );
    assert_eq!(output.diagnostics.len(), 1);
    assert_eq!(output.diagnostics[0].severity, DiagnosticSeverity::Warning);
    assert_eq!(
        output.diagnostics[0].message,
        "Warning: Missing modifier styles for \"&.size-large\" in Button"
    );
}
