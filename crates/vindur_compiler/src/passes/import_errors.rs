use oxc_ast::ast::{Expression, IdentifierReference};
use oxc_semantic::Scoping;
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use crate::{CompilerDiagnostic, facts::StaticValue};

use super::static_evaluation::resolved_constant;

/// Errors for imported values that can't be evaluated, because they are missing, only
/// re-exported, or not static, e.g. `${INSET}`, `${px(8)}` or `${theme.color}`
pub(super) fn unresolved_import_error(
    expression: &Expression<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    if let Some(diagnostic) =
        unsupported_re_export_error(expression, constants, scoping, file_path, source)
    {
        return Some(diagnostic);
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    let message = match resolved_constant(identifier, constants, scoping)? {
        StaticValue::MissingImport {
            imported_name,
            source_path,
        } => format!("Function \"{imported_name}\" not found in {source_path}"),
        StaticValue::InvalidFunction {
            source_path,
            cyclic_imports,
        }
        | StaticValue::InvalidObject {
            source_path,
            cyclic_imports,
        } => format!(
            "\"{}\" imported from {source_path} is not a static value, only strings, numbers and other statically analyzable values can be interpolated{}",
            identifier.name,
            import_cycle_hint(source_path, cyclic_imports)
        ),
        _ => return None,
    };
    Some(CompilerDiagnostic::error(
        file_path,
        source,
        expression.span(),
        message,
    ))
}

fn unsupported_re_export_error(
    expression: &Expression<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    let StaticValue::UnsupportedReExport {
        imported_name,
        source_path,
        re_export_source,
    } = find_re_export(expression, constants, scoping)?
    else {
        return None;
    };
    let message = match re_export_source {
        Some(re_export_source) => format!(
            "\"{imported_name}\" is re-exported by {source_path} from \"{re_export_source}\", re-exports via `export ... from` are not supported, import it from \"{re_export_source}\" directly"
        ),
        None => format!(
            "\"{imported_name}\" not found in {source_path}, re-exports via `export * from` are not supported, import it from the module that declares it directly"
        ),
    };
    Some(CompilerDiagnostic::error(
        file_path,
        source,
        expression.span(),
        message,
    ))
}

/// First re-exported name the expression reads, e.g. `SIZE` in `${px(SIZE + 1)}`
fn find_re_export<'c>(
    expression: &Expression<'_>,
    constants: &'c FxHashMap<String, StaticValue>,
    scoping: &Scoping,
) -> Option<&'c StaticValue> {
    match expression {
        Expression::Identifier(identifier) => resolved_constant(identifier, constants, scoping)
            .filter(|value| matches!(value, StaticValue::UnsupportedReExport { .. })),
        Expression::CallExpression(call) => find_re_export(&call.callee, constants, scoping)
            .or_else(|| {
                call.arguments.iter().find_map(|argument| {
                    find_re_export(argument.as_expression()?, constants, scoping)
                })
            }),
        Expression::StaticMemberExpression(member) => {
            find_re_export(&member.object, constants, scoping)
        }
        Expression::BinaryExpression(binary) => find_re_export(&binary.left, constants, scoping)
            .or_else(|| find_re_export(&binary.right, constants, scoping)),
        Expression::UnaryExpression(unary) => find_re_export(&unary.argument, constants, scoping),
        Expression::ParenthesizedExpression(parenthesized) => {
            find_re_export(&parenthesized.expression, constants, scoping)
        }
        _ => None,
    }
}

/// Mentions that the module was in an import cycle while collecting facts, which may be why
/// the value isn't static, empty when there was no cycle
pub(super) fn import_cycle_hint(source_path: &str, cyclic_imports: &[String]) -> String {
    if cyclic_imports.is_empty() {
        return String::new();
    }
    format!(
        ", note that {source_path} has an import cycle with {}, values that depend on modules in an import cycle can't be evaluated statically",
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
