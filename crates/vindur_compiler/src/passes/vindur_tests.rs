use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;
use pretty_assertions::assert_eq;
use rustc_hash::FxHashMap;

use super::transform_program;
use crate::{TransformOptions, edit::apply_edits};

#[test]
fn extracts_css_keyframes_and_global_styles_in_one_parse() {
    let source = r#"
import { css, createGlobalStyle, keyframes, styled } from 'vindur';
const color = 'red';
const size = 8 * 2;
const button = css`color: ${color}; padding: ${size}px;`;
const fade = keyframes`from { opacity: 0; } to { opacity: 1; }`;
const Button = styled.button`background: ${color};`;
createGlobalStyle`body { margin: 0; }`;
const App = () => <Button>Save</Button>;
"#;
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, SourceType::tsx()).parse();
    let mut output = transform_program(
        &parsed.program,
        "/test.tsx",
        source,
        &TransformOptions {
            dev: true,
            sourcemap: false,
            normalize_code: false,
            import_aliases: FxHashMap::default(),
        },
        &FxHashMap::default(),
    )
    .expect("valid transform");
    let code = apply_edits("/test.tsx", source, &mut output.edits).expect("valid edits");

    assert_eq!(
        code,
        r#"
const color = 'red';
const size = 8 * 2;
const button = "v1560qbr-1-button";
const fade = "v1560qbr-2-fade";
const App = () => <button className="v1560qbr-3-Button">Save</button>;
"#
    );
    assert_eq!(
        output.css,
        ".v1560qbr-1-button {\n  color: red; padding: 16px;\n}\n\n@keyframes v1560qbr-2-fade {\n  from { opacity: 0; } to { opacity: 1; }\n}\n\n.v1560qbr-3-Button {\n  background: red;\n}\n\nbody { margin: 0; }"
    );
}
