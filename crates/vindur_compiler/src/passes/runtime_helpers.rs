use oxc_ast::ast::{ImportDeclarationSpecifier, Program, Statement};
use oxc_semantic::{Scoping, SymbolId};

use crate::edit::Edit;

// The names generated code calls the runtime helpers by. A helper keeps its own name unless
// another binding in the file uses it, like `import cx from 'classnames'` or a `cx` parameter of
// an SVG component, which would shadow it, then it's imported under an unused alias
pub(crate) struct RuntimeHelperNames {
    pub cx: String,
    pub merge_class_names: String,
    pub merge_styles: String,
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
            if shadowed {
                unused_name(scoping, alias)
            } else {
                helper.to_owned()
            }
        });
        Self {
            cx,
            merge_class_names,
            merge_styles,
        }
    }
}

// `alias`, or `alias2`, `alias3`... when a binding or a global reference already uses it
fn unused_name(scoping: &Scoping, alias: &str) -> String {
    let is_used = |name: &str| {
        scoping
            .symbol_ids()
            .any(|symbol| scoping.symbol_name(symbol) == name)
            || scoping
                .root_unresolved_references()
                .keys()
                .any(|reference| reference.as_str() == name)
    };
    (1..)
        .map(|suffix| {
            if suffix == 1 {
                alias.to_owned()
            } else {
                format!("{alias}{suffix}")
            }
        })
        .find(|name| !is_used(name))
        .unwrap_or_else(|| alias.to_owned())
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
                "cx" => names.cx.as_str(),
                "mergeClassNames" => names.merge_class_names.as_str(),
                "mergeStyles" => names.merge_styles.as_str(),
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
    let import = format!(
        "import {{ {} }} from {quote}vindur{quote};",
        specifiers.join(", "),
    );
    // After a hashbang and directives like `'use client'`, which must stay first
    let prologue_end = program
        .directives
        .last()
        .map(|directive| directive.span.end)
        .or_else(|| program.hashbang.as_ref().map(|hashbang| hashbang.span.end))
        .unwrap_or(0);
    Some(Edit {
        span: oxc_span::Span::new(prologue_end, prologue_end),
        replacement: if prologue_end == 0 {
            format!("{import}\n")
        } else {
            format!("\n{import}")
        },
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
