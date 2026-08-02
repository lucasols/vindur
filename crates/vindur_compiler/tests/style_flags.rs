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
        "const App = ({ active }) => <button   className={\"v1560qbr-1-Button vr4ikfs-size-large\" + ((active) ? \" voctcyj-active\" : \"\")}>Save</button>;\n"
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

#[test]
fn preserves_conditional_expression_precedence_in_style_flags() {
    let source = r#"import { styled } from 'vindur';
const Button = styled.button<{ active: boolean; variant: 'today' | 'time' }>`
  &.active { opacity: 1; }
  &.variant-today { color: white; }
  &.variant-time { color: green; }
`;
const App = ({ deadline, useToday, props }) => <>
  <Button active={deadline ? isToday(deadline) : false} variant={useToday ? 'today' : 'time'}>Today</Button>
  <Button {...props} active={deadline ? isToday(deadline) : false} variant={useToday ? 'today' : 'time'}>Spread</Button>
</>;
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
        "import { cx, mergeClassNames } from 'vindur';\nconst App = ({ deadline, useToday, props }) => <>\n  <button   className={\"v1560qbr-1-Button\" + ((deadline ? isToday(deadline) : false) ? \" voctcyj-active\" : \"\") + ((useToday ? 'today' : 'time') ? \" v11as9cs-variant-\" + (useToday ? 'today' : 'time') : \"\")}>Today</button>\n  <button {...props}   className={cx(mergeClassNames([props], \"v1560qbr-1-Button\"), (deadline ? isToday(deadline) : false) && \"voctcyj-active\", (useToday ? 'today' : 'time') && `v11as9cs-variant-${(useToday ? 'today' : 'time')}`)}>Spread</button>\n</>;\n"
    );
    assert!(output.diagnostics.is_empty());
}
