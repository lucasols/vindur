use oxc_span::Span;
use rustc_hash::FxHashMap;

use super::css_syntax::{BlockKind, CssError};
use super::scoped_idents::{ScopedRole, scoped_idents};

const SCOPED_PREFIX_LEN: usize = "---".len();

/// The scoped variables of a file and how its CSS uses them, keyed by name without `---`. The
/// declared and read maps hold the location of the first style that declares or reads the variable
#[derive(Default)]
pub(crate) struct ScopedVariables {
    pub generated: FxHashMap<String, String>,
    pub declared: FxHashMap<String, Span>,
    pub read: FxHashMap<String, Span>,
    /// The lowest index a new variable can get. The css prop pass moves the file index back to
    /// precomputed class indices, so it alone can't keep variable indices unique
    pub next_index: u32,
}

/// Rewrites the scoped variables of a style block, `span` is the source location of the style
pub(crate) fn process_scoped_variables(
    css: &str,
    kind: BlockKind,
    span: Span,
    file_hash: &str,
    dev: bool,
    id_index: &mut u32,
    variables: &mut ScopedVariables,
) -> Result<String, CssError> {
    let mut output = String::with_capacity(css.len());
    let mut cursor = 0usize;
    for ident in scoped_idents(css, kind)? {
        output.push_str(&css[cursor..ident.start]);
        let name = &css[ident.start + SCOPED_PREFIX_LEN..ident.end];
        match ident.role {
            ScopedRole::Declaration => {
                variables.declared.entry(name.to_owned()).or_insert(span);
            }
            ScopedRole::Read => {
                variables.read.entry(name.to_owned()).or_insert(span);
            }
            ScopedRole::Name => {}
        }
        let generated = variables
            .generated
            .entry(name.to_owned())
            .or_insert_with(|| {
                let index = (*id_index).max(variables.next_index);
                *id_index = index + 1;
                variables.next_index = index + 1;
                if dev {
                    format!("{file_hash}-{index}-{name}")
                } else {
                    format!("{file_hash}-{index}")
                }
            });
        output.push_str("--");
        output.push_str(generated);
        cursor = ident.end;
    }
    output.push_str(&css[cursor..]);
    Ok(output)
}

#[cfg(test)]
mod tests {
    use oxc_span::Span;

    use super::{ScopedVariables, process_scoped_variables};
    use crate::passes::css_syntax::BlockKind;

    fn process(css: &str) -> String {
        process_kind(css, BlockKind::Style)
    }

    fn process_kind(css: &str, kind: BlockKind) -> String {
        let mut id_index = 1;
        let mut variables = ScopedVariables::default();
        match process_scoped_variables(
            css,
            kind,
            Span::default(),
            "v1",
            true,
            &mut id_index,
            &mut variables,
        ) {
            Ok(output) => output,
            Err(error) => panic!("{}", error.message),
        }
    }

    #[test]
    fn rewrites_declarations_and_references() {
        assert_eq!(
            process("---color: red;\ncolor: var(---color, blue);\n---size: calc(var(---gap) * 2);"),
            "--v1-1-color: red;\ncolor: var(--v1-1-color, blue);\n--v1-2-size: calc(var(--v1-3-gap) * 2);"
        );
    }

    #[test]
    fn ignores_strings_and_comments() {
        assert_eq!(
            process("content: \"a ---color b\";\n/* ---old: red; */\n---color: red;"),
            "content: \"a ---color b\";\n/* ---old: red; */\n--v1-1-color: red;"
        );
    }

    #[test]
    fn rewrites_nested_blocks_and_property_rules() {
        assert_eq!(
            process(
                "&:hover { color: var(---color); }\n@media (width > 1px) { ---color: red; }\n@property ---color { syntax: '<color>'; inherits: false; initial-value: red; }"
            ),
            "&:hover { color: var(--v1-1-color); }\n@media (width > 1px) { --v1-1-color: red; }\n@property --v1-1-color { syntax: '<color>'; inherits: false; initial-value: red; }"
        );
    }

    #[test]
    fn rewrites_container_and_supports_conditions() {
        assert_eq!(
            process(
                "---gap: 1px;\n@container card style(---gap: 1px) and (not style(---theme)) { color: red; }\n@supports (---gap: 1px) or (not (content: \"---\")) { color: blue; }"
            ),
            "--v1-1-gap: 1px;\n@container card style(--v1-1-gap: 1px) and (not style(--v1-2-theme)) { color: red; }\n@supports (--v1-1-gap: 1px) or (not (content: \"---\")) { color: blue; }"
        );
    }

    #[test]
    fn ignores_strings_in_import_urls() {
        assert_eq!(
            process("@import url('a---b.css') supports(---gap: 1px);"),
            "@import url('a---b.css') supports(--v1-1-gap: 1px);"
        );
    }

    #[test]
    fn rejects_scoped_variables_in_unsupported_preludes() {
        let mut variables = ScopedVariables::default();
        match process_scoped_variables(
            "@media (width > 1px) and (---x) { color: red; }",
            BlockKind::Style,
            Span::default(),
            "v1",
            true,
            &mut 1,
            &mut variables,
        ) {
            Ok(output) => panic!("expected an error, got {output}"),
            Err(error) => assert_eq!(
                error.message,
                "Scoped CSS variables are not supported in `@media` rule preludes"
            ),
        }
    }

    #[test]
    fn rewrites_keyframes_with_timeline_ranges() {
        assert_eq!(
            process_kind(
                "entry 0% { ---o: 0; opacity: var(---o); } to { opacity: 1; }",
                BlockKind::Keyframes
            ),
            "entry 0% { --v1-1-o: 0; opacity: var(--v1-1-o); } to { opacity: 1; }"
        );
    }

    fn declared_and_read(css: &str) -> (Vec<String>, Vec<String>) {
        let mut variables = ScopedVariables::default();
        if let Err(error) = process_scoped_variables(
            css,
            BlockKind::Style,
            Span::default(),
            "v1",
            true,
            &mut 1,
            &mut variables,
        ) {
            panic!("{}", error.message);
        }
        let mut declared = variables.declared.into_keys().collect::<Vec<_>>();
        let mut read = variables.read.into_keys().collect::<Vec<_>>();
        declared.sort();
        read.sort();
        (declared, read)
    }

    #[test]
    fn only_counts_declarations_and_var_reads() {
        assert_eq!(
            declared_and_read(
                "/* ---commented: red; */\ncontent: \"---text: x\";\n---color: red;\ncolor: var(---other, ---fallback);\n@container style(---queried: 1) { color: red; }"
            ),
            (
                vec!["color".to_owned()],
                vec!["other".to_owned(), "queried".to_owned()]
            )
        );
    }

    #[test]
    fn ignores_dashed_ident_names() {
        assert_eq!(
            declared_and_read(
                "container-name: ---card; anchor-name: ---trigger; top: anchor(---trigger bottom); transition-property: ---x; @container ---card (min-width: 1px) { color: red; } @property ---a { syntax: '<color>'; inherits: false; initial-value: red; } @supports (---s: 1px) { color: red; }"
            ),
            (Vec::new(), Vec::new())
        );
    }

    #[test]
    fn tracks_declarations_and_reads() {
        let mut variables = ScopedVariables::default();
        if let Err(error) = process_scoped_variables(
            "---a : red; color: var( ---b ); @container style(---c: dark) { ---d: 1; }",
            BlockKind::Style,
            Span::default(),
            "v1",
            true,
            &mut 1,
            &mut variables,
        ) {
            panic!("{}", error.message);
        }
        let mut declared = variables.declared.into_keys().collect::<Vec<_>>();
        let mut read = variables.read.into_keys().collect::<Vec<_>>();
        declared.sort();
        read.sort();
        assert_eq!(declared, ["a", "d"]);
        assert_eq!(read, ["b", "c"]);
    }

    #[test]
    fn counts_var_reads_in_raw_values() {
        assert_eq!(
            declared_and_read("---b: 1px; ---a: { var(---b) }; width: VAR(---a)!ie;"),
            (
                vec!["a".to_owned(), "b".to_owned()],
                vec!["a".to_owned(), "b".to_owned()]
            )
        );
    }

    #[test]
    fn rewrites_named_at_rule_preludes() {
        assert_eq!(
            process(
                "@position-try ---below { top: anchor(bottom); }
position-try-fallbacks: ---below;
@font-palette-values ---brand { font-family: x; }
font-palette: ---brand;"
            ),
            "@position-try --v1-1-below { top: anchor(bottom); }\nposition-try-fallbacks: --v1-1-below;\n@font-palette-values --v1-2-brand { font-family: x; }\nfont-palette: --v1-2-brand;"
        );
    }

    #[test]
    fn rewrites_keyframes_and_counter_style_names() {
        assert_eq!(
            process_kind(
                "@keyframes ---spin { to { opacity: 0; } } .a { animation: ---spin 1s; } @counter-style ---stars { system: cyclic; symbols: \"*\"; } ol { list-style: ---stars; }",
                BlockKind::Global
            ),
            "@keyframes --v1-1-spin { to { opacity: 0; } } .a { animation: --v1-1-spin 1s; } @counter-style --v1-2-stars { system: cyclic; symbols: \"*\"; } ol { list-style: --v1-2-stars; }"
        );
    }

    #[test]
    fn rewrites_quoted_keyframes_names() {
        assert_eq!(
            process_kind(
                "@keyframes \"---spin\" { to { opacity: 0; } } .a { animation: ---spin 1s; content: \"---spin\"; }",
                BlockKind::Global
            ),
            "@keyframes \"--v1-1-spin\" { to { opacity: 0; } } .a { animation: --v1-1-spin 1s; content: \"---spin\"; }"
        );
    }

    #[test]
    fn counts_style_queries_in_if_as_reads() {
        assert_eq!(
            declared_and_read("---a: 1; color: if(style(---a: 1): red; else: blue);"),
            (vec!["a".to_owned()], vec!["a".to_owned()])
        );
    }

    #[test]
    fn uses_one_name_for_the_same_escaped_spelling() {
        assert_eq!(
            process(
                "view-transition-name: ---f\\6f o; &::view-transition-old(---f\\6f o) { opacity: 0; }"
            ),
            "view-transition-name: --v1-1-f\\6f o; &::view-transition-old(--v1-1-f\\6f o) { opacity: 0; }"
        );
    }
}
