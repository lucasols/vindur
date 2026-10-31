use oxc_ast::ast::{Expression, IdentifierReference};
use oxc_semantic::Scoping;
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use crate::{
    CompilerDiagnostic,
    facts::{ReExport, StaticValue},
};

use super::static_evaluation::{is_unresolved_import, resolved_constant};
use super::styled::StyledComponent;

/// Errors for imported values that can't be evaluated, because they are missing, only
/// re-exported, or not static, e.g. `${INSET}`, `${px(INSET)}` or `${INSET + 1}`
pub(super) fn unresolved_import_error(
    expression: &Expression<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    let (identifier, value) = find_unresolved_import(expression, constants, scoping)?;
    let message = match value {
        StaticValue::InvalidFunction {
            source_path,
            cyclic_imports,
        }
        | StaticValue::InvalidObject {
            source_path,
            cyclic_imports,
        } => not_static_import_message(&identifier.name, source_path, cyclic_imports),
        _ => unknown_import_message(&identifier.name, value, file_path)?,
    };
    let diagnostic = CompilerDiagnostic::error(file_path, source, expression.span(), message);
    // Only reached while collecting a dependency's facts, a linted file's own imports are
    // never skipped, so lint can't locate it
    Some(if matches!(value, StaticValue::CyclicImport { .. }) {
        diagnostic.ignored_in_lint()
    } else {
        diagnostic
    })
}

/// The error for an import whose module facts aren't known, because it is missing, only
/// re-exported, or in an import cycle, `None` for other values
pub(super) fn unknown_import_message(
    name: &str,
    value: &StaticValue,
    file_path: &str,
) -> Option<String> {
    Some(match value {
        StaticValue::CyclicImport { source_path } => format!(
            "\"{name}\" imported from {source_path} can't be evaluated, {source_path} is in an import cycle with {file_path}, move the value to a module outside the cycle"
        ),
        StaticValue::MissingImport {
            imported_name,
            source_path,
        } => format!(
            "\"{imported_name}\" not found in {source_path}, export it by name, like `export const {imported_name} = ...` or `export {{ {imported_name} }}`"
        ),
        StaticValue::UnsupportedReExport {
            imported_name,
            source_path,
            re_export,
        } => re_export_message(imported_name, source_path, re_export.as_ref()),
        _ => return None,
    })
}

/// The error for a styled component rendering an import whose module facts aren't known, so its
/// style flags are unknown too, e.g. `Base` in `styled(Base)` or `Card.withComponent(Base)`
pub(super) fn unknown_element_message(
    component: &StyledComponent,
    constants: &FxHashMap<String, StaticValue>,
    file_path: &str,
) -> Option<String> {
    if !component.element_is_identifier {
        return None;
    }
    unknown_import_message(
        &component.element,
        constants.get(&component.element)?,
        file_path,
    )
}

pub(super) fn not_static_import_message(
    name: &str,
    source_path: &str,
    cyclic_imports: &[String],
) -> String {
    format!(
        "\"{name}\" imported from {source_path} is not a static value, only strings, numbers and other statically analyzable values can be interpolated{}",
        import_cycle_hint(source_path, cyclic_imports)
    )
}

fn re_export_message(
    imported_name: &str,
    source_path: &str,
    re_export: Option<&ReExport>,
) -> String {
    let Some(ReExport {
        source: re_export_source,
        imported_name: original_name,
    }) = re_export
    else {
        return format!(
            "\"{imported_name}\" not found in {source_path}, re-exports via `export * from` are not supported, import it from the module that declares it directly"
        );
    };
    let advice = match original_name {
        Some(original_name) if original_name == imported_name => {
            format!("import it from \"{re_export_source}\" directly")
        }
        Some(original_name) => {
            format!("import \"{original_name}\" from \"{re_export_source}\" directly")
        }
        None => format!("import the values you need from \"{re_export_source}\" by name"),
    };
    let syntax = if original_name.is_some() {
        "export ... from"
    } else {
        "export * as ... from"
    };
    format!(
        "\"{imported_name}\" is re-exported by {source_path} from \"{re_export_source}\", re-exports via `{syntax}` are not supported, {advice}"
    )
}

/// First unresolved imported name the expression reads, e.g. `SIZE` in `${px(SIZE + 1)}`.
/// Callees are only checked for re-exports and import cycles, other invalid callees get the
/// vindurFn error
fn find_unresolved_import<'a, 'b, 'c>(
    expression: &'a Expression<'b>,
    constants: &'c FxHashMap<String, StaticValue>,
    scoping: &Scoping,
) -> Option<(&'a IdentifierReference<'b>, &'c StaticValue)> {
    match expression {
        Expression::Identifier(identifier) => resolved_constant(identifier, constants, scoping)
            .filter(|value| is_unresolved_import(value))
            .map(|value| (&**identifier, value)),
        Expression::CallExpression(call) => {
            find_unresolved_import(&call.callee, constants, scoping)
                .filter(|(_, value)| {
                    matches!(
                        value,
                        StaticValue::CyclicImport { .. } | StaticValue::UnsupportedReExport { .. }
                    )
                })
                .or_else(|| {
                    call.arguments.iter().find_map(|argument| {
                        find_unresolved_import(argument.as_expression()?, constants, scoping)
                    })
                })
        }
        Expression::StaticMemberExpression(member) => {
            find_unresolved_import(&member.object, constants, scoping)
        }
        Expression::BinaryExpression(binary) => {
            find_unresolved_import(&binary.left, constants, scoping)
                .or_else(|| find_unresolved_import(&binary.right, constants, scoping))
        }
        Expression::UnaryExpression(unary) => {
            find_unresolved_import(&unary.argument, constants, scoping)
        }
        Expression::ParenthesizedExpression(parenthesized) => {
            find_unresolved_import(&parenthesized.expression, constants, scoping)
        }
        _ => None,
    }
}

/// Mentions that the module depended on an import cycle while collecting facts, which may be
/// why the value isn't static, empty when there was no cycle
pub(super) fn import_cycle_hint(source_path: &str, cyclic_imports: &[String]) -> String {
    if cyclic_imports.is_empty() {
        return String::new();
    }
    format!(
        ", note that {source_path} depends on an import cycle through {}, values that depend on modules in an import cycle can't be evaluated statically",
        cyclic_imports.join(", ")
    )
}

pub(super) fn member_root_identifier<'a, 'b>(
    expression: &'a Expression<'b>,
) -> Option<&'a IdentifierReference<'b>> {
    match expression {
        Expression::Identifier(identifier) => Some(identifier),
        Expression::StaticMemberExpression(member) => member_root_identifier(&member.object),
        _ => None,
    }
}
