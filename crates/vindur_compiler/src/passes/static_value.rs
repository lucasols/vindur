use oxc_ast::ast::{Expression, Program, Statement, TemplateElement, TemplateLiteral};
use oxc_semantic::Scoping;
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use crate::{CompilerDiagnostic, facts::StaticValue, semantic::VindurImports};

use super::css_syntax::CssError;
use super::css_tokens::{OpenToken, OpenTokenScanner};
use super::dynamic_color_value::{container_selector_error, invalid_color_method_error};
use super::function_evaluation::{evaluate_argument, function_evaluation_error};
use super::import_errors::unresolved_import_error;
use super::interpolation_validation::{
    interpolated_scoped_variable_error, invalid_array_argument_error,
    invalid_function_argument_error, invalid_layer_error, joined_scoped_name_error,
    open_token_end_error,
};
use super::static_evaluation::{
    collect_declaration_constants, evaluate_expression, has_css_text, is_unresolved_import,
    resolved_constant, static_value_to_string,
};
use super::styled::styled_ref_placeholder;
use super::template_css::{EvaluatedTemplate, validate_template_css};
use super::unsupported_css_syntax::unsupported_syntax_error;

pub(crate) struct TemplateContext<'a> {
    pub variable_name: Option<&'a str>,
    pub tag_type: &'a str,
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
    let mut open_tokens = OpenTokenScanner::default();
    let mut previous_was_css_extension = false;
    for (index, quasi) in template.quasis.iter().enumerate() {
        if let Some(diagnostic) = cooked_escape_error(quasi, file_path, source) {
            return Err(diagnostic);
        }
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
        if let Some(message) = function_call_error(expression, constants, scoping) {
            return Err(CompilerDiagnostic::error(
                file_path,
                source,
                expression.span(),
                message,
            ));
        }
        let expression_start = evaluated.css.len();
        let has_semicolon = template.quasis.get(index + 1).is_some_and(|next| {
            starts_with_semicolon(next.value.cooked.as_ref().unwrap_or(&next.value.raw))
        });
        let forward_reference = forward_styled_reference(expression);
        let value = match forward_reference {
            Some(_) => None,
            None => evaluate_expression(expression, constants, scoping),
        };
        let open_token = open_tokens.open_token(&evaluated.css);
        let in_string_or_comment = open_token != OpenToken::None;
        // Quoted names like `animation-name: "---spin"` are renamed too, so strings are checked
        if let Some(diagnostic) =
            joined_scoped_name_error(&evaluated.css, "", "", expression, file_path, source)
        {
            return Err(diagnostic);
        }
        if has_semicolon
            && !in_string_or_comment
            && (forward_reference.is_some() || matches!(value, Some(StaticValue::ClassName { .. })))
        {
            let expression_source =
                &source[expression.span().start as usize..expression.span().end as usize];
            return Err(CompilerDiagnostic::error(
                file_path,
                source,
                expression.span(),
                format!(
                    "`${{{expression_source}}}` is a class selector and can't be followed by `;`, use `styled(Component)` to extend a styled component's styles, or remove the `;` to use it as a selector"
                ),
            ));
        }
        if let Some(reference) = forward_reference {
            evaluated.css.push_str(&styled_ref_placeholder(reference));
            evaluated.map_expression(expression_start, expression.span());
            continue;
        }
        let Some(value) = value else {
            if let Some(diagnostic) =
                invalid_array_argument_error(expression, constants, scoping, file_path, source)
                    .or_else(|| {
                        invalid_function_argument_error(
                            expression, constants, scoping, file_path, source,
                        )
                    })
            {
                return Err(diagnostic);
            }
            let diagnostic = interpolation_error(expression, file_path, source, context);
            // The imported file may have unsaved edits that lint can't see
            return Err(
                if is_imported_object_member(expression, constants, scoping) {
                    diagnostic.ignored_in_lint()
                } else {
                    diagnostic
                },
            );
        };
        // Colors and palettes are objects, only their `.value` and methods are CSS values
        if matches!(value, StaticValue::LayerFunction)
            || !has_css_text(&value)
            || is_unresolved_import(&value)
        {
            return Err(interpolation_error(expression, file_path, source, context));
        }
        let forced_semicolon = !has_semicolon && forced_extensions.contains(&index);
        // In a string, like `content: '${base};'`, a css constant is its selector text
        let followed_by_semicolon = (has_semicolon || forced_semicolon) && !in_string_or_comment;
        if matches!(value, StaticValue::CssClass { .. })
            && !followed_by_semicolon
            && !in_string_or_comment
        {
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
                let css_after = template.quasis.get(index + 1).map_or("", quasi_text);
                // vindurFn results are written trimmed, so the checks see the written text
                let written = if matches!(expression, Expression::CallExpression(_)) {
                    value.trim()
                } else {
                    &value
                };
                if let Some(diagnostic) = open_token_end_error(
                    &evaluated.css,
                    written,
                    css_after,
                    open_token,
                    expression,
                    file_path,
                    source,
                )
                .or_else(|| {
                    interpolated_scoped_variable_error(written, expression, file_path, source)
                })
                .or_else(|| {
                    joined_scoped_name_error(
                        &evaluated.css,
                        written,
                        css_after,
                        expression,
                        file_path,
                        source,
                    )
                }) {
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

/// Whether the text starts with `;` after whitespace and comments
fn starts_with_semicolon(text: &str) -> bool {
    let mut rest = text.trim_start();
    while let Some(comment) = rest.strip_prefix("/*") {
        let Some(end) = comment.find("*/") else {
            return false;
        };
        rest = comment[end + 2..].trim_start();
    }
    rest.starts_with(';')
}

fn function_call_error(
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
    function_evaluation_error(function, &arguments)
}

/// A member chain rooted at an imported object, e.g. `theme.colors.primary`. When it can't be
/// evaluated a property is missing, which TypeScript already reports in the editor
fn is_imported_object_member(
    expression: &Expression<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
) -> bool {
    let mut current = expression;
    while let Expression::StaticMemberExpression(member) = current {
        current = &member.object;
    }
    matches!(expression, Expression::StaticMemberExpression(_))
        && matches!(current, Expression::Identifier(root) if matches!(
            resolved_constant(root, constants, scoping),
            Some(StaticValue::ImportedObject { .. })
        ))
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

pub(super) fn forward_styled_reference<'e>(expression: &'e Expression<'_>) -> Option<&'e str> {
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

/// JavaScript escapes are applied to the template text, so a CSS escape like `\e900` would lose its
/// backslash. Only `\\`, `` \` `` and `\$` are allowed. Escapes JavaScript doesn't support, like
/// `\2014`, are rejected too, otherwise the whole template would be used as written
fn cooked_escape_error(
    quasi: &TemplateElement<'_>,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    // The source text, `raw` has its CRLF line breaks normalized, which would move the offsets
    let raw = source
        .get(quasi.span.start as usize..quasi.span.end as usize)
        .unwrap_or(quasi.value.raw.as_str());
    let mut characters = raw.char_indices();
    while let Some((index, character)) = characters.next() {
        if character != '\\' {
            continue;
        }
        let (_, escaped) = characters.next()?;
        if matches!(escaped, '\\' | '`' | '$') {
            continue;
        }
        let start = quasi.span.start + u32::try_from(index).ok()?;
        let message = if escaped.is_whitespace() {
            "A `\\` before a line break or space is a JavaScript escape in the template, remove it or write `\\\\` for a CSS escape".to_owned()
        } else if escaped.is_alphanumeric() && !escaped.is_ascii_hexdigit() {
            // A CSS escape of a letter is the letter itself, like `\n` for `n`
            format!(
                "`\\{escaped}` is a JavaScript escape in the template, write the character itself or a CSS escape of its hex code, like `\\\\A` for a line break or `\\\\2014` for `—`"
            )
        } else {
            format!(
                "`\\{escaped}` is a JavaScript escape in the template, write `\\\\{escaped}` for a CSS escape"
            )
        };
        return Some(CompilerDiagnostic::error(
            file_path,
            source,
            oxc_span::Span::new(start, start + 1 + u32::try_from(escaped.len_utf8()).ok()?),
            message,
        ));
    }
    None
}

fn quasi_text<'q>(quasi: &'q TemplateElement<'_>) -> &'q str {
    quasi
        .value
        .cooked
        .as_ref()
        .unwrap_or(&quasi.value.raw)
        .as_str()
}
