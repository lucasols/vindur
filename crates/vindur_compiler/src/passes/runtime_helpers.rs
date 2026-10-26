use oxc_ast::ast::{IdentifierReference, ImportDeclarationSpecifier, Program, Statement};
use oxc_ast_visit::Visit;
use oxc_semantic::{Scoping, SymbolId};
use oxc_span::Span;

use crate::{CompilerDiagnostic, edit::Edit};

// The names generated code calls the runtime helpers by. A helper keeps its own name unless
// another binding in the file uses it, like `import cx from 'classnames'` or a `cx` parameter of
// an SVG component, which would shadow it, then it's imported under its `_v` alias. Names
// starting with `_v` are reserved by vindur, so a binding using the alias is an error
pub(crate) struct RuntimeHelperNames {
    pub cx: String,
    pub merge_class_names: String,
    pub merge_styles: String,
}

impl RuntimeHelperNames {
    pub(super) fn new(
        program: &Program<'_>,
        scoping: &Scoping,
        file_path: &str,
        source: &str,
    ) -> Result<Self, CompilerDiagnostic> {
        let name = |helper: &str, alias: &str| {
            helper_name(program, scoping, helper, alias).map_err(|span| {
                CompilerDiagnostic::error(
                    file_path,
                    source,
                    span,
                    format!(
                        "\"{alias}\" is reserved by vindur for generated code, rename this binding. Names starting with _v are reserved"
                    ),
                )
            })
        };
        Ok(Self {
            cx: name("cx", "_vCx")?,
            merge_class_names: name("mergeClassNames", "_vMergeClassNames")?,
            merge_styles: name("mergeStyles", "_vMergeStyles")?,
        })
    }
}

// `helper`, or `alias` when another binding or a global reference shadows it. Errors with the
// span of a binding or global reference that already uses `alias`
fn helper_name(
    program: &Program<'_>,
    scoping: &Scoping,
    helper: &str,
    alias: &str,
) -> Result<String, Span> {
    let own_imports = vindur_value_imports(program, helper, helper);
    // A global reference, like a `cx` from a script tag, would be captured by the import
    let shadowed = scoping
        .symbol_ids()
        .any(|symbol| scoping.symbol_name(symbol) == helper && !own_imports.contains(&symbol))
        || scoping.root_unresolved_references().contains_key(helper);
    if !shadowed {
        return Ok(helper.to_owned());
    }
    match name_use_span(program, scoping, alias) {
        Some(span) => Err(span),
        None => Ok(alias.to_owned()),
    }
}

// Where the file binds or references `name` as a global, the generated alias would clash with it
fn name_use_span(program: &Program<'_>, scoping: &Scoping, name: &str) -> Option<Span> {
    if let Some(symbol) = scoping
        .symbol_ids()
        .find(|symbol| scoping.symbol_name(*symbol) == name)
    {
        return Some(scoping.symbol_span(symbol));
    }
    if !scoping.root_unresolved_references().contains_key(name) {
        return None;
    }
    let mut finder = GlobalReferenceFinder { name, span: None };
    finder.visit_program(program);
    finder.span
}

struct GlobalReferenceFinder<'n> {
    name: &'n str,
    span: Option<Span>,
}

impl<'a> Visit<'a> for GlobalReferenceFinder<'_> {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        if self.span.is_none() && identifier.name.as_str() == self.name {
            self.span = Some(identifier.span);
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
        span: Span::new(prologue_end, prologue_end),
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
