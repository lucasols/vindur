use pretty_assertions::assert_eq;
use rustc_hash::FxHashMap;

use vindur_compiler::{Compiler, SourceLoader, TransformOptions};

struct MemoryLoader {
    files: FxHashMap<String, String>,
    reads: usize,
}

impl SourceLoader for MemoryLoader {
    fn exists(&mut self, file_path: &str) -> Result<bool, String> {
        Ok(self.files.contains_key(file_path))
    }

    fn read_file(&mut self, file_path: &str) -> Result<String, String> {
        self.reads += 1;
        self.files
            .get(file_path)
            .cloned()
            .ok_or_else(|| format!("File not found: {file_path}"))
    }
}

#[test]
fn parses_tsx_and_preserves_unmodified_source() {
    let source = "const App = () => <main>Hello</main>;";
    let output = Compiler::new().transform("/App.tsx", source, &TransformOptions::default());

    assert!(output.diagnostics.is_empty());
    assert_eq!(output.code, source);
}

#[test]
fn reports_parse_errors_with_a_source_location() {
    let output = Compiler::new().transform(
        "/App.tsx",
        "const App = <main>;",
        &TransformOptions::default(),
    );

    assert_eq!(output.diagnostics.len(), 1);
    assert_eq!(output.diagnostics[0].file_path, "/App.tsx");
    assert!(output.diagnostics[0].start.line > 0);
}

#[test]
fn transforms_direct_css_tags_inside_expressions() {
    let output = Compiler::new().transform(
        "/direct.ts",
        "import { css } from 'vindur';\nconsole.log(css`color: red;`);",
        &TransformOptions::default(),
    );

    assert!(output.diagnostics.is_empty());
    assert_eq!(output.code, "console.log(\"vfg87vj-1\");");
    assert_eq!(output.css, ".vfg87vj-1 {\n  color: red;\n}");
}

#[test]
fn uses_semantic_symbols_to_ignore_shadowed_vindur_imports() {
    let source = "import { css } from 'vindur';\nconst top = css`color: red;`;\nfunction render(css: (value: TemplateStringsArray) => string) { return css`untouched`; }";
    let output = Compiler::new().transform(
        "/shadowed.ts",
        source,
        &TransformOptions {
            normalize_code: true,
            ..TransformOptions::default()
        },
    );

    assert!(output.diagnostics.is_empty());
    assert_eq!(
        output.code,
        "const top = \"vqys53f-1\";\nfunction render(css: (value: TemplateStringsArray) => string) { return css`untouched`; }"
    );
    assert_eq!(output.css, ".vqys53f-1 {\n  color: red;\n}");
}

#[test]
fn uses_ecmascript_number_to_string_semantics() {
    let source = "import { css } from 'vindur'; const negativeZero = 0 / -1; const style = css`padding: ${negativeZero}px;`;";
    let output = Compiler::new().transform(
        "/number.ts",
        source,
        &TransformOptions {
            normalize_code: false,
            ..TransformOptions::default()
        },
    );

    assert!(output.diagnostics.is_empty());
    assert_eq!(output.css, ".versdpu-1 {\n  padding: 0px;\n}");
}

#[test]
fn does_not_evaluate_shadowed_root_constants() {
    let source = "import { css } from 'vindur'; const color = 'red'; function render(color: string) { return css`color: ${color};`; }";
    let output = Compiler::new().transform(
        "/shadowed-constant.ts",
        source,
        &TransformOptions::default(),
    );

    assert_eq!(output.diagnostics.len(), 1);
    assert!(
        output.diagnostics[0]
            .message
            .starts_with("Invalid interpolation used")
    );
    assert_eq!(output.code, source);
    assert!(output.css.is_empty());
}

#[test]
fn rejects_inline_styled_tags_with_a_location() {
    let output = Compiler::new().transform(
        "/inline.tsx",
        "import { styled } from 'vindur';\nconst value = () => styled.div`color: red;`;",
        &TransformOptions::default(),
    );

    assert_eq!(output.diagnostics.len(), 1);
    assert_eq!(
        output.diagnostics[0].message,
        "Inline styled component usage is not supported. Please assign styled components to a variable first."
    );
    assert_eq!(output.diagnostics[0].start.line, 2);
}

#[test]
fn shares_indices_between_stable_ids_and_jsx_css_props() {
    let source = "import { stableId } from 'vindur';\nexport const id = stableId();\nconst App = () => <div css={`#${id} { color: red; }`} />;";
    let output = Compiler::new().transform(
        "/test.tsx",
        source,
        &TransformOptions {
            dev: true,
            sourcemap: false,
            normalize_code: false,
            import_aliases: FxHashMap::default(),
        },
    );

    assert!(output.diagnostics.is_empty());
    assert!(output.code.contains("\"v1560qbr-id-1\""));
    assert!(output.code.contains("className=\"v1560qbr-2-css-prop-2\""));
    assert_eq!(
        output.css,
        ".v1560qbr-2-css-prop-2 {\n  #v1560qbr-id-1 { color: red; }\n}"
    );
}

#[test]
fn reserves_cx_modifier_indices_before_later_styled_components() {
    let source = r#"import { styled } from 'vindur';
const Toggle = styled.div`
  display: flex;
  &.hasSubtasks { opacity: 1; }
  &.isExpanded .icon { transform: rotate(90deg); }
`;
const App = ({ hasSubtasks, isExpanded }) => (
  <Toggle cx={{ hasSubtasks, isExpanded }}><span className="icon" /></Toggle>
);
const AttachmentButton = styled.button`width: 18px;`;
const AttachmentImage = styled.img`border: 1px solid cyan;`;
"#;
    let output = Compiler::new().transform(
        "/collision.tsx",
        source,
        &TransformOptions {
            dev: false,
            sourcemap: false,
            normalize_code: false,
            import_aliases: FxHashMap::default(),
        },
    );

    assert!(output.diagnostics.is_empty());
    assert_eq!(
        output.code,
        r#"import { cx } from 'vindur';
const App = ({ hasSubtasks, isExpanded }) => (
  <div  className={"v146u5j0-1 " + cx({
"v146u5j0-2": hasSubtasks,
"v146u5j0-3": isExpanded,
})}><span className="icon" /></div>
);
"#
    );
    assert_eq!(
        output.css,
        ".v146u5j0-1 {\n  display: flex;\n  &.v146u5j0-2 { opacity: 1; }\n  &.v146u5j0-3 .icon { transform: rotate(90deg); }\n}\n\n.v146u5j0-4 {\n  width: 18px;\n}\n\n.v146u5j0-5 {\n  border: 1px solid cyan;\n}"
    );
}

#[test]
fn evaluates_imported_functions_from_cached_module_facts() {
    let compiler = Compiler::new();
    let mut loader = MemoryLoader {
        files: FxHashMap::from_iter([(
            "/functions.ts".to_owned(),
            "import { vindurFn } from 'vindur'; export const inline = vindurFn(({ gap = 8 }) => `gap: ${gap}px;`);".to_owned(),
        )]),
        reads: 0,
    };
    let options = TransformOptions {
        import_aliases: FxHashMap::from_iter([("#/".to_owned(), "/".to_owned())]),
        ..TransformOptions::default()
    };
    let source = "import { css } from 'vindur'; import { inline } from '#/functions'; const style = css`${inline({ gap: 12 })}`;";

    let first = compiler.transform_with_loader("/first.ts", source, &options, &mut loader);
    let second = compiler.transform_with_loader("/second.ts", source, &options, &mut loader);

    assert!(first.diagnostics.is_empty());
    assert!(second.diagnostics.is_empty());
    assert!(first.css.contains("gap: 12px;"));
    assert!(second.css.contains("gap: 12px;"));
    assert_eq!(loader.reads, 1);
}
