use std::collections::HashMap;

use rustc_hash::FxHashMap;
use vindur_compiler::{Compiler, SourceLoader, TransformOptions};

struct MemoryLoader {
    files: HashMap<String, String>,
}

impl SourceLoader for MemoryLoader {
    fn exists(&mut self, file_path: &str) -> Result<bool, String> {
        Ok(self.files.contains_key(file_path))
    }

    fn read_file(&mut self, file_path: &str) -> Result<String, String> {
        self.files
            .get(file_path)
            .cloned()
            .ok_or_else(|| format!("File not found: {file_path}"))
    }
}

fn options() -> TransformOptions {
    TransformOptions {
        import_aliases: FxHashMap::from_iter([("#/".to_owned(), "/".to_owned())]),
        ..TransformOptions::default()
    }
}

#[test]
fn invalidates_changed_dependency_facts_for_hmr() {
    let compiler = Compiler::new();
    let mut loader = MemoryLoader {
        files: HashMap::from_iter([(
            "/functions.ts".to_owned(),
            "import { vindurFn } from 'vindur'; export const size = vindurFn((value) => `font-size: ${value * 1}px;`);".to_owned(),
        )]),
    };
    let source = "import { css } from 'vindur'; import { size } from '#/functions'; const style = css`${size(16)}`;";

    let first = compiler.transform_with_loader("/App.ts", source, &options(), &mut loader);
    assert!(first.css.contains("font-size: 16px;"));

    loader.files.insert(
        "/functions.ts".to_owned(),
        "import { vindurFn } from 'vindur'; export const size = vindurFn((value) => `font-size: ${value * 2}px;`);".to_owned(),
    );
    compiler.invalidate("/functions.ts");

    let updated = compiler.transform_with_loader("/App.ts", source, &options(), &mut loader);
    assert!(updated.diagnostics.is_empty());
    assert!(updated.css.contains("font-size: 32px;"));
}

#[test]
fn preserves_legacy_unexported_theme_color_extraction() {
    let compiler = Compiler::new();
    let mut loader = MemoryLoader {
        files: HashMap::from_iter([(
            "/theme.ts".to_owned(),
            "import { createStaticThemeColors } from 'vindur'; const colors = createStaticThemeColors({ primary: '#ff0000' });".to_owned(),
        )]),
    };
    let source = "import { css } from 'vindur'; import { colors } from '#/theme'; const style = css`background: ${colors.primary.var};`;";

    let output = compiler.transform_with_loader("/App.ts", source, &options(), &mut loader);

    assert!(output.diagnostics.is_empty(), "{:?}", output.diagnostics);
    assert!(!output.code.contains("import { colors }"));
    assert_eq!(output.css, ".vfxgqzu-1 {\n  background: #f00;\n}");
}

#[test]
fn avoids_nested_cx_optimization_edits_inside_css_prop_rewrites() {
    let source = r#"import { cx } from 'vindur';
const App = ({ active }) => <div className={cx('base', { active })} css={`color: red;`} />;"#;

    let output = Compiler::new().transform("/App.tsx", source, &TransformOptions::default());

    assert!(output.diagnostics.is_empty());
    assert!(output.code.contains("cx('base', { active })"));
    assert!(output.css.contains("color: red;"));
}

#[test]
fn merges_mixed_vindur_import_cleanup_after_cx_optimization() {
    let source = r#"import { cx, styled } from 'vindur';
const Box = styled.div<{ tone: 'soft' | 'hard' }>`color: red; &.tone-soft { opacity: 0.8; } &.tone-hard { opacity: 1; }`;
const App = ({ active, css }) => <Box tone="soft" css={css} className={cx({ active })} />;"#;

    let output = Compiler::new().transform("/App.tsx", source, &TransformOptions::default());

    assert!(output.diagnostics.is_empty(), "{:?}", output.diagnostics);
    assert_eq!(output.code.matches("className=").count(), 1);
}
