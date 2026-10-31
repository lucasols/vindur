use oxc_ast::ast::{
    Argument, BindingIdentifier, BindingPattern, Expression, Program, VariableDeclaration,
    VariableDeclarationKind,
};
use oxc_semantic::Scoping;
use oxc_span::GetSpan;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    CompilerDiagnostic,
    edit::{Edit, expand_removal_to_line},
    facts::StaticValue,
    semantic::VindurImports,
};

use super::{
    block_validation::check_global_start_order,
    css::{clean_css, generate_class_rules},
    css_syntax::{BlockKind, css_error_diagnostic},
    cx_modifier_selectors::StyleBlockClasses,
    function_validation::validate_vindur_function,
    function_value::try_compile_vindur_function,
    import_errors::unknown_element_message,
    scoped::{ScopedVariables, process_scoped_variables},
    static_value::{TemplateContext, evaluate_template, locate_template_error},
    style_flag_selectors::{
        all_flag_classes, missing_style_flag_classes, other_element_flag_classes,
        rewrite_style_flag_selectors, style_classes, undeclared_style_classes,
    },
    styled::{
        StyledComponent, StyledTagContext, css_class_name_part, styled_base,
        styled_tag_component_with_attrs,
    },
    styled_attrs::{AttrsHoisting, hoist_attrs, merge_attrs},
    theme_color::parse_theme_colors,
    with_component::{process_with_component, runtime_element_source, style_flags_runtime_call},
};

pub(super) struct VariableTransform<'a> {
    pub imports: &'a VindurImports<'a>,
    pub scoping: &'a Scoping,
    pub program: &'a Program<'a>,
    pub constants: &'a mut FxHashMap<String, StaticValue>,
    pub file_hash: &'a str,
    pub dev: bool,
    pub id_index: &'a mut u32,
    pub edits: &'a mut Vec<Edit>,
    pub css_rules: &'a mut Vec<String>,
    pub styled_components: &'a mut FxHashMap<String, StyledComponent>,
    pub file_path: &'a str,
    pub source: &'a str,
    pub is_exported: bool,
    /// Styled components referenced as values stay runtime components
    pub value_referenced_names: &'a FxHashSet<String>,
    /// Styled components other styled components are built from
    pub extended_names: &'a FxHashSet<String>,
    /// Start of the statement holding the declaration, including its `export`
    pub statement_start: u32,
    pub needs_styled_helper: &'a mut bool,
    pub needs_style_flags_helper: &'a mut bool,
    pub has_side_effects: &'a mut bool,
    pub scoped_variables: &'a mut ScopedVariables,
    pub warnings: &'a mut Vec<CompilerDiagnostic>,
}

pub(super) const GLOBAL_STYLE_EXPORT_ERROR: &str = "createGlobalStyle can't be exported, its styles are added where it is declared, remove the `export`";

/// The styles of a file are joined in source order, and browsers drop `@charset`, `@import` and
/// `@namespace` after another rule
pub(super) fn push_global_style(
    css_rules: &mut Vec<String>,
    has_side_effects: &mut bool,
    content: String,
    file_path: &str,
    source: &str,
    span: oxc_span::Span,
) -> Result<(), CompilerDiagnostic> {
    check_global_start_order(css_rules, &content)
        .map_err(|message| CompilerDiagnostic::error(file_path, source, span, message))?;
    if !content.is_empty() {
        css_rules.push(content);
        *has_side_effects = true;
    }
    Ok(())
}

/// Vindur declarations are evaluated once at compile time, so a `let` or `var` reassigned later
/// would keep the compiled value
pub(super) fn require_const(
    declaration: &VariableDeclaration<'_>,
    file_path: &str,
    source: &str,
) -> Result<(), CompilerDiagnostic> {
    if declaration.kind == VariableDeclarationKind::Const {
        return Ok(());
    }
    let keyword = declaration.kind.as_str();
    Err(CompilerDiagnostic::error(
        file_path,
        source,
        oxc_span::Span::new(
            declaration.span.start,
            declaration.span.start + u32::try_from(keyword.len()).unwrap_or(0),
        ),
        format!(
            "Vindur declarations must use `const`, not `{keyword}`, they are evaluated at compile time"
        ),
    ))
}

pub(super) fn process_variable_declaration(
    declaration: &VariableDeclaration<'_>,
    transform: &mut VariableTransform<'_>,
) -> Result<(), CompilerDiagnostic> {
    for declarator in &declaration.declarations {
        let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
            continue;
        };
        // Wrapped declarations are detected too, so they are rejected instead of ignored
        if let Some(initializer) = &declarator.init
            && let Expression::CallExpression(call) = initializer.get_inner_expression()
            && let Expression::Identifier(callee) = &call.callee
            && transform
                .imports
                .matches_import_or_global(callee, "vindurFn")
        {
            validate_vindur_function_declaration(declaration, identifier, initializer, transform)?;
        }
        if let Some(Expression::CallExpression(call)) = &declarator.init
            && let Expression::Identifier(callee) = &call.callee
            && transform
                .imports
                .matches_import_or_global(callee, "createDynamicCssColor")
        {
            require_const(declaration, transform.file_path, transform.source)?;
            if !call.arguments.is_empty() {
                return Err(CompilerDiagnostic::error(
                    transform.file_path,
                    transform.source,
                    call.span,
                    "createDynamicCssColor() should not be called with an ID parameter. The ID is automatically generated by the compiler."
                        .to_owned(),
                ));
            }
            // Dev ids include the variable name, like other dev class names
            let id = generated_name(
                transform.file_hash,
                *transform.id_index,
                &identifier.name,
                transform.dev,
            );
            *transform.id_index += 1;
            transform.constants.insert(
                identifier.name.to_string(),
                StaticValue::DynamicColor {
                    id: id.clone(),
                    dev: transform.dev,
                },
            );
            transform.edits.push(Edit {
                span: call.span,
                replacement: format!("{}(\"{id}\", {})", callee.name, transform.dev),
            });
            continue;
        }
        if let Some(Expression::CallExpression(call)) = &declarator.init
            && let Expression::Identifier(callee) = &call.callee
            && transform
                .imports
                .matches_import_or_global(callee, "createStaticThemeColors")
        {
            require_const(declaration, transform.file_path, transform.source)?;
            let colors = parse_theme_colors(&call.arguments).map_err(|error| {
                CompilerDiagnostic::error(
                    transform.file_path,
                    transform.source,
                    error.span,
                    error.message,
                )
            })?;
            transform.constants.insert(
                identifier.name.to_string(),
                StaticValue::ThemeColors {
                    colors,
                    dev: transform.dev,
                },
            );
            continue;
        }
        if let Some(initializer) = &declarator.init
            && process_with_component(
                initializer,
                declaration,
                identifier.name.as_str(),
                transform,
            )?
        {
            continue;
        }
        let Some(Expression::TaggedTemplateExpression(tagged)) = &declarator.init else {
            continue;
        };
        let styled_definition = styled_tag_component_with_attrs(
            &tagged.tag,
            tagged.type_arguments.as_deref(),
            &StyledTagContext {
                components: transform.styled_components,
                dev: transform.dev,
                file_hash: transform.file_hash,
                file_path: transform.file_path,
                imports: transform.imports,
                program: transform.program,
                source: transform.source,
            },
        )?;
        if let Some(styled_definition) = styled_definition {
            require_const(declaration, transform.file_path, transform.source)?;
            let base_component = styled_definition.base_component;
            let own_attrs = styled_definition.attrs;
            let own_style_flags = styled_definition.style_flags;
            if declaration.declarations.len() != 1 {
                return Err(CompilerDiagnostic::error(
                    transform.file_path,
                    transform.source,
                    declaration.span,
                    "Styled components must use their own variable declaration".to_owned(),
                ));
            }
            let variable_name = identifier.name.as_str();
            let generated_name = generated_name(
                transform.file_hash,
                *transform.id_index,
                variable_name,
                transform.dev,
            );
            *transform.id_index += 1;
            // The flags of the base component still apply, its own flags are added to them
            let mut style_flags = base_component
                .style_flags
                .iter()
                .filter(|flag| {
                    !own_style_flags
                        .iter()
                        .any(|own| own.prop_name == flag.prop_name)
                })
                .cloned()
                .collect::<Vec<_>>();
            style_flags.extend(own_style_flags.iter().cloned());
            let base_identifier = styled_base(&tagged.tag);
            // The flags of a base imported through a re-export or an import cycle are unknown, also
            // when it is rendered by a local base, e.g. `styled(Local)` with `Local = styled(Base)`
            let unknown_base =
                unknown_element_message(&base_component, transform.constants, transform.file_path)
                    .map(|message| {
                        CompilerDiagnostic::error(
                            transform.file_path,
                            transform.source,
                            base_identifier.map_or(tagged.tag.span(), |base| base.span),
                            message,
                        )
                    });
            if let Some(error) = &unknown_base
                && !own_style_flags.is_empty()
            {
                return Err(error.clone());
            }
            let flag_class_list = all_flag_classes(
                base_identifier.map(|base| base.name.as_str()),
                &base_component.style_flags,
                &own_style_flags,
                &style_flags,
                transform.constants,
            )
            .map_err(|message| {
                CompilerDiagnostic::error(
                    transform.file_path,
                    transform.source,
                    tagged
                        .type_arguments
                        .as_ref()
                        .map_or(tagged.tag.span(), |arguments| arguments.span),
                    message,
                )
            })?;
            let template_context = TemplateContext {
                variable_name: Some(variable_name),
                tag_type: "styled",
            };
            let content = evaluate_template(
                &tagged.quasi,
                transform.constants,
                transform.scoping,
                transform.file_path,
                transform.source,
                &template_context,
            )?;
            let content = clean_css(&content);
            let classes = if transform.dev || !flag_class_list.is_empty() || unknown_base.is_some()
            {
                style_classes(&content).map_err(|error| {
                    css_error_diagnostic(transform.file_path, transform.source, tagged.span, error)
                })?
            } else {
                StyleBlockClasses::default()
            };
            let element_classes = classes.element;
            // A selected class can be a flag of the base, hashed by its own module
            if let Some(error) = unknown_base
                && !element_classes.is_empty()
            {
                return Err(error);
            }
            if transform.dev {
                let other_element_flags =
                    other_element_flag_classes(&content, &classes.other, &flag_class_list);
                // Inherited flags are styled by the base component
                let missing_flags = missing_style_flag_classes(&element_classes, &own_style_flags)
                    .into_iter()
                    .filter(|class_name| !other_element_flags.contains(class_name));
                transform
                    .warnings
                    .extend(missing_flags.map(|class_name| {
                        CompilerDiagnostic::warning(
                            "",
                            transform.source,
                            identifier.span,
                            format!(
                                "Warning: Missing modifier styles for \"&.{class_name}\" in {variable_name}"
                            ),
                        )
                    }));
                transform
                    .warnings
                    .extend(other_element_flags.iter().map(|class_name| {
                        CompilerDiagnostic::warning(
                            "",
                            transform.source,
                            identifier.span,
                            format!(
                                "The style flag class \"{class_name}\" is used in a selector of another element in {variable_name}, where it is kept as written and doesn't match the flag. Flag classes only apply to the element itself, e.g. \"&.{class_name}\""
                            ),
                        )
                    }));
                let usage_prefix = format!("<{variable_name}");
                let suppress_undeclared = !base_component.class_name.is_empty()
                    || (transform.source.contains(&usage_prefix)
                        && (transform.source.contains("cx=")
                            || transform.source.contains("className={`")));
                if !suppress_undeclared {
                    // Dynamic color selectors (`color.self.isDark`) add vindur's own classes
                    let dynamic_color_prefixes = transform
                        .constants
                        .values()
                        .filter_map(|value| match value {
                            StaticValue::DynamicColor { id, .. } => Some(format!("{id}-")),
                            _ => None,
                        })
                        .collect::<Vec<_>>();
                    transform.warnings.extend(
                        undeclared_style_classes(&element_classes, &flag_class_list)
                            .into_iter()
                            .filter(|class_name| {
                                !dynamic_color_prefixes
                                    .iter()
                                    .any(|prefix| class_name.starts_with(prefix))
                            })
                            .map(|class_name| {
                                CompilerDiagnostic::warning(
                                    "",
                                    transform.source,
                                    identifier.span,
                                    format!(
                                        "The class '{class_name}' is used in CSS but not declared in the component"
                                    ),
                                )
                            }),
                    );
                }
            }
            let content =
                match rewrite_style_flag_selectors(&content, &element_classes, &flag_class_list) {
                    Ok(content) => content,
                    Err(error) => {
                        let located = locate_template_error(
                            &tagged.quasi,
                            transform.constants,
                            transform.scoping,
                            transform.file_path,
                            transform.source,
                            &template_context,
                            |css| {
                                let classes = style_classes(css).ok()?.element;
                                rewrite_style_flag_selectors(css, &classes, &flag_class_list).err()
                            },
                        )?;
                        return Err(located.unwrap_or_else(|| {
                            css_error_diagnostic(
                                transform.file_path,
                                transform.source,
                                tagged.span,
                                error,
                            )
                        }));
                    }
                };
            let content = process_scoped_variables(
                &content,
                BlockKind::Style,
                identifier.span,
                transform.file_hash,
                transform.dev,
                transform.id_index,
                transform.scoped_variables,
            )
            .map_err(|error| {
                css_error_diagnostic(transform.file_path, transform.source, tagged.span, error)
            })?;
            transform
                .css_rules
                .extend(
                    generate_class_rules(&generated_name, &content).map_err(|error| {
                        css_error_diagnostic(
                            transform.file_path,
                            transform.source,
                            tagged.span,
                            error,
                        )
                    })?,
                );
            let complete_class_name = if base_component.class_name.is_empty() {
                generated_name.clone()
            } else {
                format!("{} {generated_name}", base_component.class_name)
            };
            transform.constants.insert(
                variable_name.to_owned(),
                StaticValue::ClassName {
                    name: generated_name.clone(),
                    style_flags: flag_class_list,
                },
            );
            let has_own_attrs = own_attrs.is_some();
            let attrs = match merge_attrs(base_component.attrs.as_deref(), own_attrs) {
                // Derived components reuse the attrs, so they are evaluated only once
                Some(value)
                    if has_own_attrs && transform.extended_names.contains(variable_name) =>
                {
                    Some(hoist_attrs(
                        variable_name,
                        &value,
                        &AttrsHoisting {
                            program: transform.program,
                            scoping: transform.scoping,
                            file_path: transform.file_path,
                            source: transform.source,
                            statement_start: transform.statement_start,
                        },
                        transform.edits,
                    )?)
                }
                attrs => attrs,
            };
            let runtime = transform.is_exported
                || transform.value_referenced_names.contains(variable_name)
                || attrs.is_some()
                || base_component.runtime;
            if runtime {
                let attrs_argument = attrs
                    .as_ref()
                    .map_or(String::new(), |value| format!(", {value}"));
                let replacement = if style_flags.is_empty() {
                    *transform.needs_styled_helper = true;
                    format!(
                        "_vSC({}, \"{complete_class_name}\"{attrs_argument})",
                        runtime_element_source(
                            &base_component.element,
                            base_component.element_is_identifier
                        ),
                    )
                } else {
                    *transform.needs_style_flags_helper = true;
                    style_flags_runtime_call(
                        &style_flags,
                        &complete_class_name,
                        &base_component.element,
                        base_component.element_is_identifier,
                        attrs.as_deref(),
                    )
                };
                transform.edits.push(Edit {
                    span: tagged.span,
                    replacement,
                });
                transform.styled_components.insert(
                    variable_name.to_owned(),
                    StyledComponent {
                        attrs,
                        class_name: complete_class_name,
                        element: base_component.element,
                        element_is_identifier: base_component.element_is_identifier,
                        element_is_base: base_component.element_is_base,
                        runtime: true,
                        style_flags,
                    },
                );
                continue;
            }
            transform.styled_components.insert(
                variable_name.to_owned(),
                StyledComponent {
                    attrs: None,
                    class_name: complete_class_name,
                    element: base_component.element,
                    element_is_identifier: base_component.element_is_identifier,
                    element_is_base: base_component.element_is_base,
                    runtime: false,
                    style_flags,
                },
            );
            transform.edits.push(Edit {
                span: expand_removal_to_line(transform.source, declaration.span),
                replacement: String::new(),
            });
            continue;
        }

        let Some(tag_name) = imported_tag_name(&tagged.tag, transform.imports) else {
            continue;
        };
        if tag_name == "createGlobalStyle" {
            if transform.is_exported {
                return Err(CompilerDiagnostic::error(
                    transform.file_path,
                    transform.source,
                    identifier.span,
                    GLOBAL_STYLE_EXPORT_ERROR.to_owned(),
                ));
            }
            require_const(declaration, transform.file_path, transform.source)?;
            // The whole declaration is removed with it
            if declaration.declarations.len() != 1 {
                return Err(CompilerDiagnostic::error(
                    transform.file_path,
                    transform.source,
                    declaration.span,
                    "createGlobalStyle must use its own variable declaration".to_owned(),
                ));
            }
            if identifier.symbol_id.get().is_some_and(|symbol_id| {
                !transform
                    .scoping
                    .get_resolved_reference_ids(symbol_id)
                    .is_empty()
            }) {
                return Err(CompilerDiagnostic::error(
                    transform.file_path,
                    transform.source,
                    identifier.span,
                    format!(
                        "`{}` can't be referenced, createGlobalStyle returns nothing and its declaration is removed",
                        identifier.name
                    ),
                ));
            }
            let content = evaluate_template(
                &tagged.quasi,
                transform.constants,
                transform.scoping,
                transform.file_path,
                transform.source,
                &TemplateContext {
                    variable_name: Some(identifier.name.as_str()),
                    tag_type: "createGlobalStyle",
                },
            )?;
            let content = clean_css(&content);
            let content = process_scoped_variables(
                &content,
                BlockKind::Global,
                identifier.span,
                transform.file_hash,
                transform.dev,
                transform.id_index,
                transform.scoped_variables,
            )
            .map_err(|error| {
                css_error_diagnostic(transform.file_path, transform.source, tagged.span, error)
            })?;
            push_global_style(
                transform.css_rules,
                transform.has_side_effects,
                content,
                transform.file_path,
                transform.source,
                tagged.span,
            )?;
            transform.edits.push(Edit {
                span: expand_removal_to_line(transform.source, declaration.span),
                replacement: String::new(),
            });
            continue;
        }
        if !matches!(tag_name, "css" | "keyframes") {
            continue;
        }
        require_const(declaration, transform.file_path, transform.source)?;

        let variable_name = identifier.name.as_str();
        let generated_name = generated_name(
            transform.file_hash,
            *transform.id_index,
            variable_name,
            transform.dev,
        );
        *transform.id_index += 1;

        let content = evaluate_template(
            &tagged.quasi,
            transform.constants,
            transform.scoping,
            transform.file_path,
            transform.source,
            &TemplateContext {
                variable_name: Some(variable_name),
                tag_type: tag_name,
            },
        )?;
        let content = clean_css(&content);
        let content = process_scoped_variables(
            &content,
            BlockKind::from_tag_type(tag_name),
            identifier.span,
            transform.file_hash,
            transform.dev,
            transform.id_index,
            transform.scoped_variables,
        )
        .map_err(|error| {
            css_error_diagnostic(transform.file_path, transform.source, tagged.span, error)
        })?;
        if !content.is_empty() {
            let rules = if tag_name == "keyframes" {
                vec![format!("@keyframes {generated_name} {{\n  {content}\n}}")]
            } else {
                generate_class_rules(&generated_name, &content).map_err(|error| {
                    css_error_diagnostic(transform.file_path, transform.source, tagged.span, error)
                })?
            };
            transform.css_rules.extend(rules);
        }
        transform.constants.insert(
            variable_name.to_owned(),
            if tag_name == "css" {
                StaticValue::CssClass {
                    name: generated_name.clone(),
                    css: content,
                }
            } else {
                StaticValue::Keyframes(generated_name.clone())
            },
        );
        transform.edits.push(Edit {
            span: tagged.span,
            replacement: format!("\"{generated_name}\""),
        });
    }
    Ok(())
}

fn validate_vindur_function_declaration(
    declaration: &VariableDeclaration<'_>,
    identifier: &BindingIdentifier<'_>,
    initializer: &Expression<'_>,
    transform: &VariableTransform<'_>,
) -> Result<(), CompilerDiagnostic> {
    let error = |span, message| {
        Err(CompilerDiagnostic::error(
            transform.file_path,
            transform.source,
            span,
            message,
        ))
    };
    if let Some(validation) =
        validate_vindur_function(identifier.name.as_str(), initializer, transform.source)
    {
        let span = if validation.message.starts_with("vindurFn must be called") {
            identifier.span
        } else {
            validation.span
        };
        return error(span, validation.message);
    }
    if !transform.is_exported {
        return error(
            identifier.span,
            format!(
                "vindurFn \"{}\" must be exported, locally declared vindurFn functions are not supported. If you are trying to use a vindurFn function, you must import it from another file.",
                identifier.name
            ),
        );
    }
    // Only const arrow function declarations are compiled, other forms can't be used
    let is_arrow_function = matches!(
        initializer,
        Expression::CallExpression(call)
            if matches!(call.arguments.as_slice(), [Argument::ArrowFunctionExpression(_)])
    );
    if declaration.kind != VariableDeclarationKind::Const || !is_arrow_function {
        return error(
            identifier.span,
            format!(
                "vindurFn \"{}\" is not supported, vindur functions must be declared with \"export const {} = vindurFn((...) => ...)\"",
                identifier.name, identifier.name
            ),
        );
    }
    if let Some(Err(span)) = try_compile_vindur_function(initializer, transform.imports) {
        return error(
            span,
            format!(
                "vindurFn \"{}\" contains unsupported syntax \"{}\", it can't be evaluated at compile time",
                identifier.name,
                &transform.source[span.start as usize..span.end as usize]
            ),
        );
    }
    Ok(())
}

pub(super) fn generated_name(
    file_hash: &str,
    id_index: u32,
    variable_name: &str,
    dev: bool,
) -> String {
    if dev {
        format!(
            "{file_hash}-{id_index}-{}",
            css_class_name_part(variable_name)
        )
    } else {
        format!("{file_hash}-{id_index}")
    }
}

pub(super) fn imported_tag_name<'a>(
    tag: &Expression<'_>,
    imports: &'a VindurImports<'_>,
) -> Option<&'a str> {
    imports.get_expression(tag)
}
