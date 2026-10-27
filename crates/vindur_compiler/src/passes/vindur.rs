use std::hash::{Hash, Hasher};

use oxc_ast::ast::{Expression, Program, Statement};
use oxc_semantic::Scoping;
use oxc_span::GetSpan;
use rustc_hash::{FxHashMap, FxHashSet, FxHasher};

use crate::{
    CompilerDiagnostic, ModuleFacts, TransformOptions,
    edit::{Edit, expand_removal_to_line},
    facts::StaticValue,
    hash::murmur2,
    semantic::VindurImports,
};

use super::{
    css::{clean_css, generate_class_rules},
    css_syntax::{BlockKind, css_error_diagnostic},
    cx_optimize::optimize_cx_calls,
    cx_references::non_call_cx_reference_error,
    direct::{DirectTransform, transform_direct_tags},
    dynamic_color::{DynamicColorTransform, transform_dynamic_color_props},
    id_order::{IdEvent, collect_jsx_id_events, jsx_id_starts},
    import_analysis::{
        assigned_tag_spans, collect_exported_names, collect_exported_object_names,
        collect_re_exports, collect_vindur_imports,
    },
    jsx_css::{JsxCssTransform, transform_jsx_css_props},
    jsx_cx::{CxElementTransform, JsxCxTransform, transform_jsx_cx_props},
    jsx_cx_component_references::component_reference_modifier_error,
    runtime_helpers::{RuntimeHelperNames, runtime_helper_import},
    scoped::{ScopedVariables, process_scoped_variables},
    source_map::css_template_offsets,
    stable::{
        StableDeclarationTransform, StableInlineTransform, transform_inline_stable_calls,
        transform_stable_declaration,
    },
    static_evaluation::is_unresolved_import,
    static_value::{TemplateContext, collect_constants, evaluate_template},
    styled::{resolve_styled_references, styled_tag_element},
    styled_attrs::collect_extended_names,
    styled_jsx::{StyledJsxTransform, rewrite_styled_jsx},
    transform_support::{VariableTransform, imported_tag_name, process_variable_declaration},
    value_references::collect_value_referenced_names,
    vindur_fn_references::runtime_vindur_fn_reference_error,
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
    cyclic_values: &FxHashSet<String>,
) -> Result<PassOutput, CompilerDiagnostic> {
    let mut imports = VindurImports::new(scoping);
    let mut edits = Vec::new();
    collect_vindur_imports(program, file_path, source, &mut imports, &mut edits)?;
    let exported_names = collect_exported_names(program);

    // Imported values come first so local constants can reference them, e.g.
    // `export const INSET = IMPORTED_INSET`. Local style values, e.g. `css` classes and
    // theme colors, are only known after `collect_constants`, imported ones are added after
    // it too, so constants derived from them aren't static in both cases. Values from
    // modules in an import cycle are added after it too, they can only be used directly
    let (late_values, imported_constants): (FxHashMap<_, _>, _) = imported_values
        .iter()
        .map(|(name, value)| {
            let value = match value {
                StaticValue::Function(function) => StaticValue::ImportedFunction(function.clone()),
                value => value.clone(),
            };
            (name.clone(), value)
        })
        .partition(|(name, value)| is_style_value(value) || cyclic_values.contains(name));
    let mut constants = collect_constants(program, scoping, &imports, imported_constants);
    constants.extend(late_values);
    for (local_name, imported_name) in imports.iter_names() {
        if imported_name == "layer" {
            constants.insert(local_name.to_owned(), StaticValue::LayerFunction);
        }
    }
    let function_names = constants
        .iter()
        .filter(|(_, value)| {
            matches!(
                value,
                StaticValue::Function(_) | StaticValue::ImportedFunction(_)
            )
        })
        .map(|(name, _)| name.as_str())
        .collect();
    if let Some(diagnostic) = non_call_cx_reference_error(program, scoping, file_path, source) {
        return Err(diagnostic);
    }
    if let Some(diagnostic) = runtime_vindur_fn_reference_error(
        program,
        scoping,
        &imports,
        &function_names,
        file_path,
        source,
    ) {
        return Err(diagnostic);
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
    let mut hashed_styled_modifiers = Vec::new();
    let helper_names = RuntimeHelperNames::new(program, scoping, file_path, source)?;
    let mut class_expressions: FxHashMap<u32, String> = FxHashMap::default();
    let mut scoped_variables = ScopedVariables::default();
    let mut warnings = Vec::new();
    let value_referenced_names =
        collect_value_referenced_names(program, scoping, &imports, file_path, source)?;
    let extended_names = collect_extended_names(program, &imports);
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
                        is_exported: exported_names.values().any(|local| {
                            declaration
                                .declarations
                                .first()
                                .and_then(|declarator| declarator.id.get_binding_identifier())
                                .is_some_and(|identifier| identifier.name == local.as_str())
                        }),
                        value_referenced_names: &value_referenced_names,
                        extended_names: &extended_names,
                        statement_start: declaration.span.start,
                        needs_styled_helper: &mut needs_styled_helper,
                        needs_style_flags_helper: &mut needs_style_flags_helper,
                        scoped_variables: &mut scoped_variables,
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
                            value_referenced_names: &value_referenced_names,
                            extended_names: &extended_names,
                            statement_start: export.span.start,
                            needs_styled_helper: &mut needs_styled_helper,
                            needs_style_flags_helper: &mut needs_style_flags_helper,
                            scoped_variables: &mut scoped_variables,
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
                            style_flags: &[],
                        },
                    )?;
                    let content = process_scoped_variables(
                        &clean_css(&content),
                        BlockKind::Global,
                        tagged.span,
                        &file_hash,
                        options.dev,
                        &mut id_index,
                        &mut scoped_variables,
                    )
                    .map_err(|error| css_error_diagnostic(file_path, source, tagged.span, error))?;
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
                            style_flags: &[],
                        },
                    )?;
                    let content = process_scoped_variables(
                        &clean_css(&content),
                        BlockKind::Style,
                        tagged.span,
                        &file_hash,
                        options.dev,
                        &mut id_index,
                        &mut scoped_variables,
                    )
                    .map_err(|error| css_error_diagnostic(file_path, source, tagged.span, error))?;
                    css_rules.extend(generate_class_rules(&generated_name, &content).map_err(
                        |error| css_error_diagnostic(file_path, source, tagged.span, error),
                    )?);
                    needs_styled_helper = true;
                    edits.push(Edit {
                        span: tagged.span,
                        replacement: format!("_vSC(\"{element}\", \"{generated_name}\")"),
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
            exported_names: &exported_names,
            file_hash: &file_hash,
            file_path,
            source,
            dev: options.dev,
            id_index: &mut id_index,
            id_starts: &jsx_id_starts,
            edits: &mut edits,
            css_rules: &mut css_rules,
            elements: &mut cx_elements,
            hashed_styled_modifiers: &mut hashed_styled_modifiers,
            class_expressions: &mut class_expressions,
            warnings: &mut warnings,
            needs_cx_helper: &mut needs_cx_helper,
            needs_merge_helper: &mut needs_merge_helper,
            helper_names: &helper_names,
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
            helper_names: &helper_names,
            cx_elements: &cx_elements,
            class_expressions: &mut class_expressions,
            scoped_variables: &mut scoped_variables,
        },
    )?;

    transform_dynamic_color_props(
        program,
        DynamicColorTransform {
            constants: &constants,
            scoping,
            edits: &mut edits,
            file_path,
            needs_merge_class_names: &mut needs_merge_helper,
            needs_merge_styles: &mut needs_merge_styles_helper,
            helper_names: &helper_names,
            source,
            styled_components: &styled_components,
            class_expressions: &class_expressions,
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
            helper_names: &helper_names,
        },
    )?;

    let needed_helpers = [
        (needs_styled_helper, "_vSC"),
        (needs_style_flags_helper, "_vCWM"),
        (needs_cx_helper, "cx"),
        (needs_merge_helper, "mergeClassNames"),
        (needs_merge_styles_helper, "mergeStyles"),
    ]
    .into_iter()
    .filter_map(|(needed, helper)| needed.then_some(helper))
    .collect::<Vec<_>>();
    edits.extend(runtime_helper_import(
        program,
        source,
        &helper_names,
        &needed_helpers,
    ));

    // The user's `cx` import is kept while generated code calls it under its own name
    let calls_user_cx = needs_cx_helper && helper_names.cx == "cx";

    optimize_cx_calls(program, scoping, source, &mut edits, calls_user_cx);

    let mut hasher = FxHasher::default();
    source.hash(&mut hasher);
    // Unresolved imports exported with `export { name }` describe paths relative to this
    // module, importers report them as values of this module instead. Values from modules
    // in an import cycle aren't passed on either, their facts depend on the transform order
    let exports = exported_names
        .iter()
        .filter(|(_, local)| !cyclic_values.contains(*local))
        .filter_map(|(name, local)| {
            constants
                .get(local)
                .filter(|value| !is_unresolved_import(value))
                .cloned()
                .map(|value| (name.clone(), value))
        })
        .collect();
    let (re_exports, star_re_exports) = collect_re_exports(program);
    let facts = ModuleFacts {
        declared_exports: exported_names.into_keys().collect(),
        declared_object_exports: exported_object_names.iter().cloned().collect(),
        source_hash: hasher.finish(),
        constants,
        exports,
        re_exports,
        star_re_exports,
        // Filled in by the compiler from the loaded imports
        ..ModuleFacts::default()
    };
    // Every style is generated here, also the css props after the cx pass
    if let Some(diagnostic) =
        component_reference_modifier_error(&css_rules, &hashed_styled_modifiers, file_path, source)
    {
        return Err(diagnostic);
    }
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
        &scoped_variables,
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

/// Values created by vindur APIs, they are registered while transforming their declarations
fn is_style_value(value: &StaticValue) -> bool {
    matches!(
        value,
        StaticValue::ClassName(_)
            | StaticValue::CssClass { .. }
            | StaticValue::DynamicColor { .. }
            | StaticValue::DynamicColorPath { .. }
            | StaticValue::Keyframes(_)
            | StaticValue::ThemeColor { .. }
            | StaticValue::ThemeColorContrast { .. }
            | StaticValue::ThemeColors(_)
            | StaticValue::UnexportedThemeColors(_)
    )
}

fn scoped_variable_warnings(
    variables: &ScopedVariables,
    file_path: &str,
    source: &str,
) -> Vec<CompilerDiagnostic> {
    let mut warnings = Vec::new();
    for name in variables.generated.keys() {
        match (variables.declared.get(name), variables.read.get(name)) {
            (Some(&span), None) => warnings.push(CompilerDiagnostic::warning(
                file_path,
                source,
                span,
                format!("Scoped variable '---{name}' is declared but never read"),
            )),
            (None, Some(&span)) => warnings.push(CompilerDiagnostic::warning(
                file_path,
                source,
                span,
                format!("Scoped variable '---{name}' is used but never declared"),
            )),
            _ => {}
        }
    }
    warnings.sort_by(|left, right| left.message.cmp(&right.message));
    warnings
}

#[cfg(test)]
#[path = "vindur_tests.rs"]
mod tests;
