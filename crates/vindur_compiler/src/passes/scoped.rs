use rustc_hash::FxHashMap;

use super::css_syntax::{CssError, scoped_idents};

const SCOPED_PREFIX_LEN: usize = "---".len();

pub(crate) fn declared_scoped_variable_names(css: &str) -> Result<Vec<String>, CssError> {
    Ok(scoped_idents(css)?
        .into_iter()
        .filter(|ident| ident.is_declaration)
        .map(|ident| css[ident.start + SCOPED_PREFIX_LEN..ident.end].to_owned())
        .collect())
}

pub(crate) fn process_scoped_variables(
    css: &str,
    file_hash: &str,
    dev: bool,
    id_index: &mut u32,
    variables: &mut FxHashMap<String, String>,
) -> Result<String, CssError> {
    let mut output = String::with_capacity(css.len());
    let mut cursor = 0usize;
    for ident in scoped_idents(css)? {
        output.push_str(&css[cursor..ident.start]);
        let name = &css[ident.start + SCOPED_PREFIX_LEN..ident.end];
        let generated = variables.entry(name.to_owned()).or_insert_with(|| {
            let index = *id_index;
            *id_index += 1;
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
    use rustc_hash::FxHashMap;

    use super::{declared_scoped_variable_names, process_scoped_variables};

    fn process(css: &str) -> String {
        let mut id_index = 1;
        let mut variables = FxHashMap::default();
        match process_scoped_variables(css, "v1", true, &mut id_index, &mut variables) {
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
    fn only_counts_declarations_as_declared() {
        let names = match declared_scoped_variable_names(
            "/* ---commented: red; */\ncontent: \"---text: x\";\n---color: red;\ncolor: var(---other);",
        ) {
            Ok(names) => names,
            Err(error) => panic!("{}", error.message),
        };
        assert_eq!(names, vec!["color".to_owned()]);
    }
}
