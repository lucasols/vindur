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
        r#"const App = ({ hasSubtasks, isExpanded }) => (
  <div  className={"v146u5j0-1" + (hasSubtasks ? " v146u5j0-2" : "") + (isExpanded ? " v146u5j0-3" : "")}><span className="icon" /></div>
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

/// R imports `SIZE` from B, which derives it through the B -> A -> D -> B import cycle
fn import_cycle_loader() -> MemoryLoader {
    MemoryLoader {
        files: FxHashMap::from_iter([
            (
                "/R.tsx".to_owned(),
                "import { css } from 'vindur'; import { SIZE } from '#/B'; const style = css`top: ${SIZE}px;`;".to_owned(),
            ),
            (
                "/B.ts".to_owned(),
                "import { A_VAL } from '#/A'; export const SIZE = A_VAL;".to_owned(),
            ),
            (
                "/A.ts".to_owned(),
                "import { D_VAL } from '#/D'; export const A_VAL = D_VAL;".to_owned(),
            ),
            (
                "/D.ts".to_owned(),
                "import { SIZE } from '#/B'; export const D_VAL = 4; export const D_SIZE = SIZE;"
                    .to_owned(),
            ),
        ]),
        reads: 0,
    }
}

fn transform_file(
    compiler: &Compiler,
    loader: &mut MemoryLoader,
    file_path: &str,
) -> vindur_compiler::TransformOutput {
    let options = TransformOptions {
        import_aliases: FxHashMap::from_iter([("#/".to_owned(), "/".to_owned())]),
        ..TransformOptions::default()
    };
    let source = loader.files[file_path].clone();
    compiler.transform_with_loader(file_path, &source, &options, loader)
}

fn error_messages(output: &vindur_compiler::TransformOutput) -> Vec<String> {
    output
        .diagnostics
        .iter()
        .map(|diagnostic| diagnostic.message.clone())
        .collect()
}

const IMPORT_CYCLE_ERROR: &str = "\"SIZE\" imported from /B.ts is not a static value, only strings, numbers and other statically analyzable values can be interpolated, note that /B.ts depends on an import cycle through /A.ts, values that depend on modules in an import cycle can't be evaluated statically";

#[test]
fn rejects_values_derived_through_import_cycles_in_any_transform_order() {
    let compiler = Compiler::new();
    let mut loader = import_cycle_loader();
    let entry_first = transform_file(&compiler, &mut loader, "/R.tsx");

    let compiler = Compiler::new();
    let mut loader = import_cycle_loader();
    assert!(
        transform_file(&compiler, &mut loader, "/A.ts")
            .diagnostics
            .is_empty()
    );
    let cycle_member_first = transform_file(&compiler, &mut loader, "/R.tsx");

    assert_eq!(error_messages(&entry_first), [IMPORT_CYCLE_ERROR]);
    assert_eq!(error_messages(&cycle_member_first), [IMPORT_CYCLE_ERROR]);
}

#[test]
fn keeps_rejecting_values_derived_through_import_cycles_after_unrelated_edits() {
    let compiler = Compiler::new();
    let mut loader = import_cycle_loader();
    assert!(
        transform_file(&compiler, &mut loader, "/A.ts")
            .diagnostics
            .is_empty()
    );

    loader.files.insert(
        "/D.ts".to_owned(),
        "import { SIZE } from '#/B'; export const D_VAL = 6; export const D_SIZE = SIZE;"
            .to_owned(),
    );
    compiler.invalidate("/D.ts");

    assert_eq!(
        error_messages(&transform_file(&compiler, &mut loader, "/R.tsx")),
        [IMPORT_CYCLE_ERROR]
    );
}

#[test]
fn recompiles_values_derived_through_import_cycles_once_the_cycle_is_removed() {
    for first_file in ["/R.tsx", "/A.ts"] {
        let compiler = Compiler::new();
        let mut loader = import_cycle_loader();
        transform_file(&compiler, &mut loader, first_file);
        transform_file(&compiler, &mut loader, "/R.tsx");

        loader
            .files
            .insert("/D.ts".to_owned(), "export const D_VAL = 4;".to_owned());
        compiler.invalidate("/D.ts");

        let recompiled = transform_file(&compiler, &mut loader, "/R.tsx");
        let fresh = transform_file(&Compiler::new(), &mut loader, "/R.tsx");
        assert!(recompiled.diagnostics.is_empty(), "{first_file}");
        assert_eq!(recompiled.css, fresh.css, "{first_file}");
        assert!(recompiled.css.contains("top: 4px;"), "{first_file}");
    }
}

fn memory_loader(files: &[(&str, &str)]) -> MemoryLoader {
    MemoryLoader {
        files: files
            .iter()
            .map(|(path, source)| ((*path).to_owned(), (*source).to_owned()))
            .collect(),
        reads: 0,
    }
}

#[test]
fn reports_values_imported_back_into_an_import_cycle() {
    let compiler = Compiler::new();
    let mut loader = memory_loader(&[
        (
            "/Layout.tsx",
            "import { Sidebar } from '#/Sidebar'; export const HEADER_HEIGHT = 4; export const App = () => <Sidebar />;",
        ),
        (
            "/Sidebar.tsx",
            "import { css } from 'vindur'; import { HEADER_HEIGHT } from '#/Layout'; export const Sidebar = () => <div className={css`top: ${HEADER_HEIGHT}px;`} />;",
        ),
    ]);

    assert_eq!(
        error_messages(&transform_file(&compiler, &mut loader, "/Layout.tsx")),
        [
            "\"HEADER_HEIGHT\" imported from /Layout.tsx can't be evaluated, /Layout.tsx is in an import cycle with /Sidebar.tsx, move the value to a module outside the cycle"
        ]
    );
}

#[test]
fn rejects_values_passed_through_an_import_cycle_in_any_transform_order() {
    let files = [
        ("/A.ts", "import { b } from '#/B'; export const AV = 4;"),
        (
            "/B.ts",
            "import { AV } from '#/A'; export const b = 1; export { AV };",
        ),
        (
            "/D.tsx",
            "import { css } from 'vindur'; import { AV } from '#/B'; const style = css`width: ${AV}px;`;",
        ),
    ];
    let expected = [
        "\"AV\" imported from /B.ts is not a static value, only strings, numbers and other statically analyzable values can be interpolated, note that /B.ts depends on an import cycle through /A.ts, values that depend on modules in an import cycle can't be evaluated statically",
    ];

    for first_file in ["/D.tsx", "/A.ts", "/B.ts"] {
        let compiler = Compiler::new();
        let mut loader = memory_loader(&files);
        transform_file(&compiler, &mut loader, first_file);

        assert_eq!(
            error_messages(&transform_file(&compiler, &mut loader, "/D.tsx")),
            expected,
            "{first_file}"
        );
    }
}

#[test]
fn recompiles_once_an_import_cycle_is_removed_at_the_module_it_closes_at() {
    let compiler = Compiler::new();
    let mut loader = memory_loader(&[
        (
            "/R.ts",
            "import { A_VAL } from '#/A'; export const R_VAL = 8; export const R_A = A_VAL;",
        ),
        (
            "/A.ts",
            "import { B_VAL } from '#/B'; export const A_VAL = B_VAL;",
        ),
        (
            "/B.ts",
            "import { R_VAL } from '#/R'; export const B_VAL = R_VAL;",
        ),
        (
            "/C.tsx",
            "import { css } from 'vindur'; import { A_VAL } from '#/A'; const style = css`top: ${A_VAL}px;`;",
        ),
    ]);
    assert!(
        transform_file(&compiler, &mut loader, "/R.ts")
            .diagnostics
            .is_empty()
    );

    loader
        .files
        .insert("/R.ts".to_owned(), "export const R_VAL = 8;".to_owned());
    compiler.invalidate("/R.ts");

    let recompiled = transform_file(&compiler, &mut loader, "/C.tsx");
    assert!(recompiled.diagnostics.is_empty());
    assert!(recompiled.css.contains("top: 8px;"));
}
