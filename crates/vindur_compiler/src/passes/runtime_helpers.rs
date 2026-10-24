use oxc_ast::ast::{ImportDeclarationSpecifier, Program, Statement};
use oxc_semantic::{Scoping, SymbolId};

use crate::edit::Edit;

// The names generated code calls the runtime helpers by. A helper keeps its own name unless
// another binding in the file uses it, like `import cx from 'classnames'` or a `cx` parameter of
// an SVG component, which would shadow it, then it's imported under a reserved alias
pub(crate) struct RuntimeHelperNames {
    pub cx: &'static str,
    pub merge_class_names: &'static str,
    pub merge_styles: &'static str,
}

const HELPERS: [(&str, &str); 3] = [
    ("cx", "_vCx"),
    ("mergeClassNames", "_vMergeClassNames"),
    ("mergeStyles", "_vMergeStyles"),
];

impl RuntimeHelperNames {
    pub(super) fn new(program: &Program<'_>, scoping: &Scoping) -> Self {
        let [cx, merge_class_names, merge_styles] = HELPERS.map(|(helper, alias)| {
            let own_imports = vindur_value_imports(program, helper, helper);
            let shadowed = scoping.symbol_ids().any(|symbol| {
                scoping.symbol_name(symbol) == helper && !own_imports.contains(&symbol)
            });
            if shadowed { alias } else { helper }
        });
        Self {
            cx,
            merge_class_names,
            merge_styles,
        }
    }
}

// The import of the helpers generated code calls, skipping the ones the file already imports
// under the name they're called by
pub(super) fn runtime_helper_import(
    program: &Program<'_>,
    source: &str,
    names: &RuntimeHelperNames,
    needed: &[&'static str],
) -> Option<Edit> {
    let specifiers = needed
        .iter()
        .filter_map(|helper| {
            let name = match *helper {
                "cx" => names.cx,
                "mergeClassNames" => names.merge_class_names,
                "mergeStyles" => names.merge_styles,
                _ => helper,
            };
            if !vindur_value_imports(program, helper, name).is_empty() {
                return None;
            }
            Some(if name == *helper {
                (*helper).to_owned()
            } else {
                format!("{helper} as {name}")
            })
        })
        .collect::<Vec<_>>();
    if specifiers.is_empty() {
        return None;
    }
    let quote = vindur_import_quote(program, source);
    Some(Edit {
        span: oxc_span::Span::new(0, 0),
        replacement: format!(
            "import {{ {} }} from {quote}vindur{quote};\n",
            specifiers.join(", "),
        ),
    })
}

// Value imports of `imported` from vindur bound to `local`. Type-only imports are erased, so they
// don't bind anything at runtime
fn vindur_value_imports(program: &Program<'_>, imported: &str, local: &str) -> Vec<SymbolId> {
    program
        .body
        .iter()
        .filter_map(|statement| {
            let Statement::ImportDeclaration(declaration) = statement else {
                return None;
            };
            (declaration.source.value.as_str() == "vindur" && declaration.import_kind.is_value())
                .then_some(declaration)
        })
        .flat_map(|declaration| declaration.specifiers.iter().flatten())
        .filter_map(|specifier| {
            let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier else {
                return None;
            };
            (specifier.import_kind.is_value()
                && specifier.imported.name().as_str() == imported
                && specifier.local.name.as_str() == local)
                .then(|| specifier.local.symbol_id())
        })
        .collect()
}

fn vindur_import_quote(program: &Program<'_>, source: &str) -> char {
    program
        .body
        .iter()
        .find_map(|statement| {
            let Statement::ImportDeclaration(import) = statement else {
                return None;
            };
            if import.source.value.as_str() != "vindur" {
                return None;
            }
            source
                .as_bytes()
                .get(import.source.span.start as usize)
                .copied()
                .map(char::from)
        })
        .filter(|quote| matches!(quote, '\'' | '"'))
        .unwrap_or('"')
}
