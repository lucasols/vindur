use oxc_ast::ast::{Expression, Program, Statement, TemplateElement, TemplateLiteral};
use oxc_semantic::Scoping;
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use crate::{CompilerDiagnostic, facts::StaticValue, semantic::VindurImports};

use super::css_syntax::CssError;
use super::dynamic_color_value::{container_selector_error, invalid_color_method_error};
use super::function_evaluation::{evaluate_argument, function_binary_expression_error};
use super::import_errors::{
    member_root_identifier, not_static_import_message, unresolved_import_error,
};
use super::interpolation_validation::{
    interpolated_scoped_variable_error, invalid_array_argument_error, invalid_layer_error,
};
use super::static_evaluation::{
    collect_declaration_constants, evaluate_expression, is_unresolved_import, resolved_constant,
    static_value_to_string,
};
use super::styled::{StyleFlag, styled_ref_placeholder};
use super::template_css::{EvaluatedTemplate, validate_template_css};
use super::unsupported_css_syntax::unsupported_syntax_error;

pub(crate) struct TemplateContext<'a> {
    pub variable_name: Option<&'a str>,
    pub tag_type: &'a str,
    /// Style flags of a styled component, their selectors are replaced after validation
    pub style_flags: &'a [StyleFlag],
}

pub(crate) fn collect_constants(
    program: &Program<'_>,
    scoping: &Scoping,
    imports: &VindurImports<'_>,
    mut constants: FxHashMap<String, StaticValue>,
) -> FxHashMap<String, StaticValue> {
    for statement in &program.body {
        match statement {
            Statement::VariableDeclaration(declaration) => {
                collect_declaration_constants(declaration, &mut constants, scoping, imports);
            }
            Statement::ExportNamedDeclaration(export) => {
                if let Some(oxc_ast::ast::Declaration::VariableDeclaration(declaration)) =
                    &export.declaration
                {
                    collect_declaration_constants(declaration, &mut constants, scoping, imports);
                }
            }
            _ => {}
        }
    }
    constants
}

/// Evaluates a style template to CSS, the result is validated with the CSS parser
pub(crate) fn evaluate_template(
    template: &TemplateLiteral<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
    file_path: &str,
    source: &str,
    context: &TemplateContext<'_>,
) -> Result<String, CompilerDiagnostic> {
    let build = |forced_extensions: &[usize]| {
        build_template_css(
            template,
            constants,
            scoping,
            file_path,
            source,
            context,
            forced_extensions,
        )
    };
    let evaluated = build(&[])?;
    if let Some(diagnostic) = unsupported_syntax_error(
        &evaluated.css,
        &evaluated.segments,
        template.span,
        context.tag_type,
        file_path,
        source,
    ) {
        return Err(diagnostic);
    }
    validate_template_css(&evaluated, template, file_path, source, context, build)?;
    Ok(evaluated.css)
}

/// Locates an error found after evaluation, e.g. by rewriting the flag selectors of the CSS. The
/// CSS is evaluated again, as the offsets of the cleaned CSS don't map to the source
pub(crate) fn locate_template_error(
    template: &TemplateLiteral<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
    file_path: &str,
    source: &str,
    context: &TemplateContext<'_>,
    find_error: impl Fn(&str) -> Option<CssError>,
) -> Result<Option<CompilerDiagnostic>, CompilerDiagnostic> {
    let evaluated = build_template_css(
        template,
        constants,
        scoping,
        file_path,
        source,
        context,
        &[],
    )?;
    Ok(find_error(&evaluated.css)
        .map(|error| evaluated.error_diagnostic(error, template, file_path, source)))
}

/// `forced_extensions` evaluates the CSS class interpolations at those indices as style
/// extensions, as if they were followed by `;`
fn build_template_css(
    template: &TemplateLiteral<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
    file_path: &str,
    source: &str,
    context: &TemplateContext<'_>,
    forced_extensions: &[usize],
) -> Result<EvaluatedTemplate, CompilerDiagnostic> {
    let mut evaluated = EvaluatedTemplate::default();
    let mut previous_was_css_extension = false;
    for (index, quasi) in template.quasis.iter().enumerate() {
        let quasi_start = evaluated.css.len();
        evaluated.css.push_str(quasi_text(quasi));
        evaluated.map_quasi(quasi_start, quasi);
        let Some(expression) = template.expressions.get(index) else {
            continue;
        };
        if let Some(diagnostic) =
            invalid_color_method_error(expression, constants, scoping, file_path, source)
        {
            return Err(diagnostic);
        }
        if let Some(diagnostic) =
            invalid_layer_error(expression, constants, scoping, file_path, source)
        {
            return Err(diagnostic);
        }
        // Global styles have no `&`, a container selector there styles the elements under it
        if context.tag_type != "createGlobalStyle"
            && let Some(diagnostic) = container_selector_error(
                expression,
                // The evaluated CSS so far, so earlier interpolations count as part of the selector
                (
                    &evaluated.css,
                    template.quasis.get(index + 1).map(quasi_text),
                ),
                constants,
                scoping,
                file_path,
                source,
            )
        {
            return Err(diagnostic);
        }
        if let Some(diagnostic) =
            invalid_object_access_error(expression, constants, scoping, file_path, source, context)
        {
            return Err(diagnostic);
        }
        if matches!(expression, Expression::ArrowFunctionExpression(_))
            && forward_styled_reference(expression).is_none()
        {
            let variable_context = context.variable_name.map_or_else(
                || context.tag_type.to_owned(),
                |name| format!("... {name} = {}", context.tag_type),
            );
            return Err(CompilerDiagnostic::error(
                file_path,
                source,
                expression.span(),
                format!(
                    "Invalid arrow function in interpolation at `{variable_context}`. Only simple forward references like ${{() => Component}} are supported"
                ),
            ));
        }
        if let Some(diagnostic) =
            unresolved_import_error(expression, constants, scoping, file_path, source)
        {
            return Err(diagnostic);
        }
        if let Expression::CallExpression(call) = expression
            && let Expression::Identifier(callee) = &call.callee
            && let Some(StaticValue::InvalidFunction { .. }) =
                resolved_constant(callee, constants, scoping)
        {
            return Err(CompilerDiagnostic::error(
                file_path,
                source,
                expression.span(),
                "called a invalid vindur function, style functions must be defined with \"vindurFn(() => ...)\" function"
                    .to_owned(),
            ));
        }
        if let Expression::CallExpression(call) = expression
            && let Expression::Identifier(callee) = &call.callee
            && let Some(StaticValue::ImportedValue { .. }) =
                resolved_constant(callee, constants, scoping)
        {
            return Err(CompilerDiagnostic::error(
                file_path,
                source,
                expression.span(),
                "called a invalid vindur function, style functions must be defined with \"vindurFn(() => ...)\" function"
                    .to_owned(),
            ));
        }
        if let Some(message) = binary_expression_error(expression, constants, scoping) {
            return Err(CompilerDiagnostic::error(
                file_path,
                source,
                expression.span(),
                format!("Binary expression evaluation failed: {message}"),
            ));
        }
        let expression_start = evaluated.css.len();
        if let Some(reference) = forward_styled_reference(expression) {
            evaluated.css.push_str(&styled_ref_placeholder(reference));
            evaluated.map_expression(expression_start, expression.span());
            continue;
        }
        let Some(value) = evaluate_expression(expression, constants, scoping) else {
            if let Some(diagnostic) =
                invalid_array_argument_error(expression, constants, scoping, file_path, source)
            {
                return Err(diagnostic);
            }
            return Err(interpolation_error(expression, file_path, source, context));
        };
        // Colors and palettes are objects, only their `.value` and methods are CSS values
        if matches!(
            value,
            StaticValue::Object(_)
                | StaticValue::ImportedObject { .. }
                | StaticValue::LayerFunction
                | StaticValue::DynamicColor { .. }
                | StaticValue::DynamicColorPath { .. }
                | StaticValue::ThemeColor { .. }
                | StaticValue::ThemeColorContrast { .. }
                | StaticValue::ThemeColors { .. }
                | StaticValue::UnexportedThemeColors { .. }
        ) || is_unresolved_import(&value)
        {
            return Err(interpolation_error(expression, file_path, source, context));
        }
        let has_semicolon = template.quasis.get(index + 1).is_some_and(|next| {
            next.value
                .cooked
                .as_ref()
                .unwrap_or(&next.value.raw)
                .trim_start()
                .starts_with(';')
        });
        let forced_semicolon = !has_semicolon && forced_extensions.contains(&index);
        let followed_by_semicolon = has_semicolon || forced_semicolon;
        if matches!(value, StaticValue::CssClass { .. }) && !followed_by_semicolon {
            evaluated.selector_classes.push(index);
        }
        let is_css_extension =
            matches!(value, StaticValue::CssClass { .. }) && followed_by_semicolon;
        let static_before_expression = quasi
            .value
            .cooked
            .as_ref()
            .unwrap_or(&quasi.value.raw)
            .trim()
            .trim_matches(';')
            .trim();
        if is_css_extension && (previous_was_css_extension || !static_before_expression.is_empty())
        {
            evaluated.css.push('\n');
        }
        let value = match &value {
            StaticValue::CssClass { css, .. } if followed_by_semicolon => css.clone(),
            StaticValue::CssClass { name, .. } => format!(".{name}"),
            value => {
                let value = static_value_to_string(value);
                if let Some(diagnostic) =
                    interpolated_scoped_variable_error(&value, expression, file_path, source)
                {
                    return Err(diagnostic);
                }
                value
            }
        };
        if matches!(expression, Expression::CallExpression(_)) {
            let preserves_boundary =
                imported_function_preserves_boundary(expression, constants, scoping);
            if preserves_boundary
                && !evaluated
                    .css
                    .trim_end_matches([' ', '\t'])
                    .ends_with("\n\n")
            {
                evaluated.css.push('\n');
            }
            evaluated.css.push_str(value.trim());
            if value.contains(';') && !followed_by_semicolon && preserves_boundary {
                evaluated.css.push('\n');
            }
        } else {
            evaluated.css.push_str(&value);
        }
        if forced_semicolon {
            evaluated.css.push(';');
        }
        evaluated.map_expression(expression_start, expression.span());
        previous_was_css_extension = is_css_extension;
    }
    Ok(evaluated)
}

fn binary_expression_error(
    expression: &Expression<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
) -> Option<String> {
    let Expression::CallExpression(call) = expression else {
        return None;
    };
    let Expression::Identifier(callee) = &call.callee else {
        return None;
    };
    let function = match resolved_constant(callee, constants, scoping)? {
        StaticValue::Function(function) | StaticValue::ImportedFunction(function) => function,
        _ => return None,
    };
    let arguments = call
        .arguments
        .iter()
        .map(|argument| evaluate_argument(argument, constants, scoping))
        .collect::<Option<Vec<_>>>()?;
    function_binary_expression_error(function, &arguments)
}

fn invalid_object_access_error(
    expression: &Expression<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
    file_path: &str,
    source: &str,
    context: &TemplateContext<'_>,
) -> Option<CompilerDiagnostic> {
    let Expression::StaticMemberExpression(member) = expression else {
        return None;
    };
    if let Expression::Identifier(root) = &member.object {
        return match resolved_constant(root, constants, scoping)? {
            StaticValue::Object(_) => {
                Some(interpolation_error(expression, file_path, source, context))
            }
            StaticValue::ImportedObject {
                properties,
                source_path,
            } if !properties.contains_key(member.property.name.as_str()) => Some(
                CompilerDiagnostic::error(
                    file_path,
                    source,
                    expression.span(),
                    format!(
                        "Property \"{}\" not found on imported object \"{}\" from {source_path}",
                        member.property.name, root.name
                    ),
                )
                .ignored_in_lint(),
            ),
            StaticValue::MissingImport {
                imported_name,
                source_path,
            } => Some(CompilerDiagnostic::error(
                file_path,
                source,
                expression.span(),
                format!("Object \"{imported_name}\" not found in {source_path}"),
            )),
            StaticValue::InvalidObject {
                source_path,
                cyclic_imports,
            } => Some(CompilerDiagnostic::error(
                file_path,
                source,
                expression.span(),
                not_static_import_message(&root.name, source_path, cyclic_imports),
            )),
            _ => None,
        };
    }
    let root = member_root_identifier(&member.object)?;
    let Some(StaticValue::ImportedObject {
        properties,
        source_path,
    }) = resolved_constant(root, constants, scoping)
    else {
        return None;
    };
    let path = member_path(expression);
    let missing_depth = missing_property_depth(properties, &path)?;
    Some(
        CompilerDiagnostic::error(
            file_path,
            source,
            expression.span(),
            format!(
                "Property \"{}\" not found on imported object \"{}\" from {source_path}",
                path[..=missing_depth].join("."),
                root.name
            ),
        )
        .ignored_in_lint(),
    )
}

/// The property names of a member chain, e.g. `["container", "isDark"]` for `scheme.container.isDark`
fn member_path<'a>(expression: &'a Expression<'_>) -> Vec<&'a str> {
    let mut path = Vec::new();
    let mut current = expression;
    while let Expression::StaticMemberExpression(member) = current {
        path.push(member.property.name.as_str());
        current = &member.object;
    }
    path.reverse();
    path
}

/// The index in `path` of the first property missing from nested objects, `None` when every
/// object along the path has the property or the path reaches a non object value
fn missing_property_depth(
    properties: &FxHashMap<String, StaticValue>,
    path: &[&str],
) -> Option<usize> {
    let mut current = properties;
    for (depth, name) in path.iter().enumerate() {
        match current.get(*name) {
            None => return Some(depth),
            Some(StaticValue::Object(nested)) => current = nested,
            Some(_) => return None,
        }
    }
    None
}

fn imported_function_preserves_boundary(
    expression: &Expression<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
) -> bool {
    let Expression::CallExpression(call) = expression else {
        return false;
    };
    let Expression::Identifier(callee) = &call.callee else {
        return false;
    };
    let Some(StaticValue::ImportedFunction(function)) =
        resolved_constant(callee, constants, scoping)
    else {
        return false;
    };
    let crate::facts::FunctionExpression::Template { quasis, .. } = &function.body else {
        return false;
    };
    quasis.last().is_some_and(|quasi| quasi.contains('\n'))
}

fn forward_styled_reference<'e>(expression: &'e Expression<'_>) -> Option<&'e str> {
    let Expression::ArrowFunctionExpression(arrow) = expression else {
        return None;
    };
    if !arrow.expression || !arrow.params.items.is_empty() || arrow.params.rest.is_some() {
        return None;
    }
    let [Statement::ExpressionStatement(statement)] = arrow.body.statements.as_slice() else {
        return None;
    };
    let Expression::Identifier(identifier) = &statement.expression else {
        return None;
    };
    Some(identifier.name.as_str())
}

fn interpolation_error(
    expression: &Expression<'_>,
    file_path: &str,
    source: &str,
    context: &TemplateContext<'_>,
) -> CompilerDiagnostic {
    let expression_span = expression.span();
    let expression_source = &source[expression_span.start as usize..expression_span.end as usize];
    let variable_context = context.variable_name.map_or_else(
        || context.tag_type.to_owned(),
        |name| format!("... {name} = {}", context.tag_type),
    );

    let (message, ignore_in_lint) = match expression {
        Expression::Identifier(_) => (
            format!(
                "Invalid interpolation used at `{variable_context}` ... ${{{expression_source}}}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported"
            ),
            true,
        ),
        Expression::CallExpression(_) => (
            format!(
                "Unresolved function call at `{variable_context}` ... ${{{expression_source}}}, function must be statically analyzable and correctly imported with the configured aliases"
            ),
            false,
        ),
        Expression::BinaryExpression(_) => (
            format!(
                "Unresolved binary expression at `{variable_context}` ... ${{{expression_source}}}, only simple arithmetic with constants is supported"
            ),
            false,
        ),
        _ => (
            format!(
                "Invalid interpolation used at `{variable_context}` ... ${{{expression_source}}}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported"
            ),
            false,
        ),
    };
    let diagnostic = CompilerDiagnostic::error(file_path, source, expression_span, message);
    if ignore_in_lint {
        diagnostic.ignored_in_lint()
    } else {
        diagnostic
    }
}

fn quasi_text<'q>(quasi: &'q TemplateElement<'_>) -> &'q str {
    quasi
        .value
        .cooked
        .as_ref()
        .unwrap_or(&quasi.value.raw)
        .as_str()
}
