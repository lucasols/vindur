use std::hash::{Hash, Hasher};

use oxc_ast::ast::{Expression, Program, Statement};
use oxc_semantic::Scoping;
use oxc_span::GetSpan;
use rustc_hash::{FxHashMap, FxHasher};

use crate::{
    CompilerDiagnostic, ModuleFacts, TransformOptions,
    edit::{Edit, expand_removal_to_line},
    facts::StaticValue,
    hash::murmur2,
    semantic::VindurImports,
};

use super::{
    css::clean_css,
    css_warnings::css_extension_warnings,
    cx_optimize::optimize_cx_calls,
    direct::{DirectTransform, transform_direct_tags},
    dynamic_color::{DynamicColorTransform, transform_dynamic_color_props},
    id_order::{IdEvent, collect_jsx_id_events, jsx_id_starts},
    import_analysis::{
        assigned_tag_spans, collect_exported_names, collect_exported_object_names,
        collect_resolved_import_edits, collect_vindur_imports,
    },
    jsx_css::{JsxCssTransform, transform_jsx_css_props},
    jsx_cx::{CxElementTransform, JsxCxTransform, transform_jsx_cx_props},
    scoped::{declared_scoped_variable_names, process_scoped_variables},
    source_map::css_template_offsets,
    stable::{
        StableDeclarationTransform, StableInlineTransform, transform_inline_stable_calls,
        transform_stable_declaration,
    },
    static_value::{TemplateContext, collect_constants, evaluate_template},
    styled::{resolve_styled_references, styled_tag_element},
    styled_jsx::{StyledJsxTransform, rewrite_styled_jsx},
    transform_support::{VariableTransform, imported_tag_name, process_variable_declaration},
};

pub(crate) struct PassOutput {
    pub edits: Vec<Edit>,
    pub css: String,
    pub facts: ModuleFacts,
    pub warnings: Vec<CompilerDiagnostic>,
    pub css_source_offsets: Vec<u32>,
}

pub(crate) fn transform_program(
    program: &Program<'_>,
    scoping: &Scoping,
    file_path: &str,
    source: &str,
    options: &TransformOptions,
    imported_values: &FxHashMap<String, StaticValue>,
) -> Result<PassOutput, CompilerDiagnostic> {
    let mut imports = VindurImports::new(scoping);
    let mut edits = Vec::new();
    collect_vindur_imports(program, source, &mut imports, &mut edits);
    collect_resolved_import_edits(program, source, imported_values, &mut edits);

    let mut constants = collect_constants(program, scoping);
    constants.extend(imported_values.iter().map(|(name, value)| {
        let value = match value {
            StaticValue::Function(function) => StaticValue::ImportedFunction(function.clone()),
            value => value.clone(),
        };
        (name.clone(), value)
    }));
    for (local_name, imported_name) in imports.iter_names() {
        if imported_name == "layer" {
            constants.insert(local_name.to_owned(), StaticValue::LayerFunction);
        }
    }
    let file_hash = format!("v{}", murmur2(file_path));
    let mut css_rules = Vec::new();
    let mut styled_components = FxHashMap::default();
    let mut handled_calls = Vec::new();
    let mut needs_merge_helper = false;
    let mut needs_merge_styles_helper = false;
    let mut needs_styled_helper = false;
    let mut needs_style_flags_helper = false;
    let mut needs_cx_helper = false;
    let mut cx_elements: FxHashMap<u32, CxElementTransform> = FxHashMap::default();
    let mut scoped_variables = FxHashMap::default();
    let mut scoped_declaration_spans = FxHashMap::default();
    let mut warnings = Vec::new();
    let exported_names = collect_exported_names(program);
    let exported_object_names = collect_exported_object_names(program);
    let jsx_id_events = collect_jsx_id_events(program);
    let mut jsx_event_index = 0_usize;
    let mut id_index = 1_u32;
    let mut declaration_id_events = Vec::new();

    for statement in &program.body {
        while let Some(event) = jsx_id_events.get(jsx_event_index)
            && event.start < statement.span().start
        {
            id_index += event.count;
            jsx_event_index += 1;
        }
        let id_before_statement = id_index;
        match statement {
            Statement::VariableDeclaration(declaration) => {
                transform_stable_declaration(
                    declaration,
                    &mut StableDeclarationTransform {
                        imports: &imports,
                        constants: &mut constants,
                        file_hash: &file_hash,
                        file_path,
                        source,
                        id_index: &mut id_index,
                        edits: &mut edits,
                        handled_calls: &mut handled_calls,
                    },
                )?;
                process_variable_declaration(
                    declaration,
                    &mut VariableTransform {
                        imports: &imports,
                        scoping,
                        program,
                        constants: &mut constants,
                        file_hash: &file_hash,
                        dev: options.dev,
                        id_index: &mut id_index,
                        edits: &mut edits,
                        css_rules: &mut css_rules,
                        styled_components: &mut styled_components,
                        file_path,
                        source,
                        is_exported: exported_names.contains(
                            declaration
                                .declarations
                                .first()
                                .and_then(|declarator| declarator.id.get_binding_identifier())
                                .map_or("", |identifier| identifier.name.as_str()),
                        ),
                        needs_styled_helper: &mut needs_styled_helper,
                        needs_style_flags_helper: &mut needs_style_flags_helper,
                        scoped_variables: &mut scoped_variables,
                        scoped_declaration_spans: &mut scoped_declaration_spans,
                        warnings: &mut warnings,
                    },
                )?;
            }
            Statement::ExportNamedDeclaration(export) => {
                if let Some(oxc_ast::ast::Declaration::VariableDeclaration(declaration)) =
                    &export.declaration
                {
                    transform_stable_declaration(
                        declaration,
                        &mut StableDeclarationTransform {
                            imports: &imports,
                            constants: &mut constants,
                            file_hash: &file_hash,
                            file_path,
                            source,
                            id_index: &mut id_index,
                            edits: &mut edits,
                            handled_calls: &mut handled_calls,
                        },
                    )?;
                    process_variable_declaration(
                        declaration,
                        &mut VariableTransform {
                            imports: &imports,
                            scoping,
                            program,
                            constants: &mut constants,
                            file_hash: &file_hash,
                            dev: options.dev,
                            id_index: &mut id_index,
                            edits: &mut edits,
                            css_rules: &mut css_rules,
                            styled_components: &mut styled_components,
                            file_path,
                            source,
                            is_exported: true,
                            needs_styled_helper: &mut needs_styled_helper,
                            needs_style_flags_helper: &mut needs_style_flags_helper,
                            scoped_variables: &mut scoped_variables,
                            scoped_declaration_spans: &mut scoped_declaration_spans,
                            warnings: &mut warnings,
                        },
                    )?;
                }
            }
            Statement::ExpressionStatement(statement) => {
                if let Expression::TaggedTemplateExpression(tagged) = &statement.expression
                    && imported_tag_name(&tagged.tag, &imports) == Some("createGlobalStyle")
                {
                    id_index += 1;
                    let content = evaluate_template(
                        &tagged.quasi,
                        &constants,
                        scoping,
                        file_path,
                        source,
                        &TemplateContext {
                            variable_name: None,
                            tag_type: "createGlobalStyle",
                        },
                    )?;
                    let content = process_scoped_variables(
                        &clean_css(&content),
                        &file_hash,
                        false,
                        &mut id_index,
                        &mut scoped_variables,
                    );
                    for name in declared_scoped_variable_names(&content) {
                        scoped_declaration_spans.entry(name).or_insert(tagged.span);
                    }
                    if !content.is_empty() {
                        css_rules.push(content);
                    }
                    edits.push(Edit {
                        span: expand_removal_to_line(source, statement.span),
                        replacement: String::new(),
                    });
                }
            }
            Statement::ExportDefaultDeclaration(export) => {
                if let oxc_ast::ast::ExportDefaultDeclarationKind::TaggedTemplateExpression(tagged) =
                    &export.declaration
                    && let Some(element) = styled_tag_element(&tagged.tag, &imports)
                {
                    let generated_name = format!("{file_hash}-{id_index}");
                    id_index += 1;
                    let content = evaluate_template(
                        &tagged.quasi,
                        &constants,
                        scoping,
                        file_path,
                        source,
                        &TemplateContext {
                            variable_name: None,
                            tag_type: "styled",
                        },
                    )?;
                    let content = process_scoped_variables(
                        &clean_css(&content),
                        &file_hash,
                        options.dev,
                        &mut id_index,
                        &mut scoped_variables,
                    );
                    if !content.is_empty() {
                        css_rules.push(format!(".{generated_name} {{\n  {content}\n}}"));
                    }
                    edits.push(Edit {
                        span: tagged.span,
                        replacement: format!(
                            "styledComponent(\"{element}\", \"{generated_name}\")"
                        ),
                    });
                }
            }
            _ => {}
        }
        if id_index > id_before_statement {
            declaration_id_events.push(IdEvent {
                start: statement.span().start,
                count: id_index - id_before_statement,
            });
        }
    }
    id_index += jsx_id_events[jsx_event_index..]
        .iter()
        .map(|event| event.count)
        .sum::<u32>();

    let jsx_id_starts = jsx_id_starts(&jsx_id_events, &declaration_id_events);

    transform_inline_stable_calls(
        program,
        StableInlineTransform {
            imports: &imports,
            handled_calls: &handled_calls,
            file_hash: &file_hash,
            file_path,
            source,
            id_index: &mut id_index,
            edits: &mut edits,
        },
    )?;

    let mut handled_spans = assigned_tag_spans(program);
    handled_spans.extend(edits.iter().map(|edit| edit.span));
    transform_direct_tags(
        program,
        DirectTransform {
            imports: &imports,
            constants: &constants,
            scoping,
            handled_spans: &handled_spans,
            file_hash: &file_hash,
            file_path,
            source,
            edits: &mut edits,
            css_rules: &mut css_rules,
            id_index: &mut id_index,
            dev: options.dev,
            scoped_variables: &mut scoped_variables,
        },
    )?;

    transform_jsx_cx_props(
        program,
        JsxCxTransform {
            constants: &constants,
            scoping,
            styled_components: &styled_components,
            file_hash: &file_hash,
            file_path,
            source,
            dev: options.dev,
            id_index: &mut id_index,
            id_starts: &jsx_id_starts,
            edits: &mut edits,
            css_rules: &mut css_rules,
            elements: &mut cx_elements,
            warnings: &mut warnings,
            needs_cx_helper: &mut needs_cx_helper,
        },
    )?;

    transform_jsx_css_props(
        program,
        JsxCssTransform {
            constants: &constants,
            scoping,
            styled_components: &styled_components,
            file_hash: &file_hash,
            file_path,
            source,
            dev: options.dev,
            id_index: &mut id_index,
            id_starts: &jsx_id_starts,
            edits: &mut edits,
            css_rules: &mut css_rules,
            needs_merge_helper: &mut needs_merge_helper,
            cx_elements: &cx_elements,
            scoped_variables: &mut scoped_variables,
        },
    )?;

    transform_dynamic_color_props(
        program,
        DynamicColorTransform {
            constants: &constants,
            scoping,
            imported_values,
            edits: &mut edits,
            file_path,
            needs_merge_class_names: &mut needs_merge_helper,
            needs_merge_styles: &mut needs_merge_styles_helper,
            source,
            styled_components: &styled_components,
        },
    )?;

    rewrite_styled_jsx(
        program,
        StyledJsxTransform {
            components: &styled_components,
            constants: &constants,
            scoping,
            edits: &mut edits,
            file_path,
            source,
            needs_cx_helper: &mut needs_cx_helper,
            needs_merge_helper: &mut needs_merge_helper,
        },
    )?;

    if options.dev {
        warnings.extend(css_extension_warnings(
            program, &constants, scoping, file_path, source,
        ));
    }

    let mut runtime_helpers = Vec::new();
    if needs_styled_helper {
        runtime_helpers.push("_vSC");
    }
    if needs_style_flags_helper {
        runtime_helpers.push("_vCWM");
    }
    if needs_cx_helper {
        runtime_helpers.push("cx");
    }
    if needs_merge_helper {
        runtime_helpers.push("mergeClassNames");
    }
    if needs_merge_styles_helper {
        runtime_helpers.push("mergeStyles");
    }
    runtime_helpers.retain(|helper| !has_named_vindur_import(program, helper));
    if !runtime_helpers.is_empty() {
        let quote = vindur_import_quote(program, source);
        edits.push(Edit {
            span: oxc_span::Span::new(0, 0),
            replacement: format!(
                "import {{ {} }} from {quote}vindur{quote};\n",
                runtime_helpers.join(", "),
            ),
        });
    }

    optimize_cx_calls(program, source, &mut edits);

    let mut hasher = FxHasher::default();
    source.hash(&mut hasher);
    let exports = exported_names
        .iter()
        .filter_map(|name| {
            constants
                .get(name)
                .cloned()
                .map(|value| (name.clone(), value))
        })
        .collect();
    let facts = ModuleFacts {
        declared_exports: exported_names.iter().cloned().collect(),
        declared_object_exports: exported_object_names.iter().cloned().collect(),
        source_hash: hasher.finish(),
        constants,
        exports,
        dependencies: Vec::new(),
    };
    if let Some(reference) = resolve_styled_references(&mut css_rules, &styled_components) {
        return Err(CompilerDiagnostic::error(
            file_path,
            source,
            oxc_span::Span::new(0, 0),
            format!(
                "Forward reference to undefined styled component: {reference}. Make sure the component is defined in the same file."
            ),
        ));
    }
    let css = css_rules.join("\n\n");
    warnings.extend(scoped_variable_warnings(
        &css,
        &scoped_variables,
        &scoped_declaration_spans,
        file_path,
        source,
    ));

    Ok(PassOutput {
        edits,
        css,
        facts,
        warnings,
        css_source_offsets: css_template_offsets(program, &imports),
    })
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

fn has_named_vindur_import(program: &Program<'_>, name: &str) -> bool {
    program.body.iter().any(|statement| {
        let Statement::ImportDeclaration(import) = statement else {
            return false;
        };
        if import.source.value.as_str() != "vindur" {
            return false;
        }
        import.specifiers.as_ref().is_some_and(|specifiers| {
            specifiers.iter().any(|specifier| {
                let oxc_ast::ast::ImportDeclarationSpecifier::ImportSpecifier(specifier) =
                    specifier
                else {
                    return false;
                };
                specifier.imported.name().as_str() == name
            })
        })
    })
}

fn scoped_variable_warnings(
    css: &str,
    variables: &FxHashMap<String, String>,
    declaration_spans: &FxHashMap<String, oxc_span::Span>,
    file_path: &str,
    source: &str,
) -> Vec<CompilerDiagnostic> {
    let mut warnings = Vec::new();
    for (name, generated) in variables {
        let declared = css.contains(&format!("--{generated}:"));
        let used = css.contains(&format!("var(--{generated}"));
        if declared && !used {
            warnings.push(CompilerDiagnostic::warning(
                file_path,
                source,
                declaration_spans
                    .get(name)
                    .copied()
                    .unwrap_or_else(|| oxc_span::Span::new(0, 0)),
                format!("Scoped variable '---{name}' is declared but never read"),
            ));
        } else if used && !declared {
            warnings.push(CompilerDiagnostic::warning(
                file_path,
                source,
                oxc_span::Span::new(0, 0),
                format!("Scoped variable '---{name}' is used but never declared"),
            ));
        }
    }
    warnings.sort_by(|left, right| left.message.cmp(&right.message));
    warnings
}

#[cfg(test)]
#[path = "vindur_tests.rs"]
mod tests;
