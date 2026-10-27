use oxc_ast::ast::{Argument, BindingPattern, Declaration, Expression, Program, Statement};
use oxc_semantic::Scoping;
use rustc_hash::FxHashSet;

use crate::{CompilerDiagnostic, edit::Edit, semantic::VindurImports};

use super::runtime_helpers::reserved_name_error;

/// Top level styled components other top level styled components are built from, with
/// `styled(Base)` or `Base.withComponent()`. Their attrs are reused by the derived components,
/// so they are hoisted to a constant to be evaluated only once.
pub(super) fn collect_extended_names(
    program: &Program<'_>,
    imports: &VindurImports<'_>,
) -> FxHashSet<String> {
    let mut names = FxHashSet::default();
    for statement in &program.body {
        let declaration = match statement {
            Statement::VariableDeclaration(declaration) => declaration,
            Statement::ExportNamedDeclaration(export) => {
                let Some(Declaration::VariableDeclaration(declaration)) = &export.declaration
                else {
                    continue;
                };
                declaration
            }
            _ => continue,
        };
        for declarator in &declaration.declarations {
            if !matches!(declarator.id, BindingPattern::BindingIdentifier(_)) {
                continue;
            }
            let base = match declarator
                .init
                .as_ref()
                .map(Expression::without_parentheses)
            {
                Some(Expression::CallExpression(call)) => match &call.callee {
                    Expression::StaticMemberExpression(member)
                        if member.property.name.as_str() == "withComponent" =>
                    {
                        identifier_name(&member.object)
                    }
                    _ => None,
                },
                Some(Expression::TaggedTemplateExpression(tagged)) => {
                    styled_call_base(&tagged.tag, imports)
                }
                _ => None,
            };
            if let Some(base) = base {
                names.insert(base.to_owned());
            }
        }
    }
    names
}

// The `Base` of a `styled(Base)` call in a styled tag chain, e.g. `styled(Base).attrs({})`
fn styled_call_base<'a>(tag: &'a Expression<'_>, imports: &VindurImports<'_>) -> Option<&'a str> {
    match tag {
        Expression::CallExpression(call) => match &call.callee {
            Expression::Identifier(callee)
                if imports.matches_import_or_global(callee, "styled") =>
            {
                match call.arguments.first() {
                    Some(Argument::Identifier(base)) => Some(base.name.as_str()),
                    _ => None,
                }
            }
            callee => styled_call_base(callee, imports),
        },
        Expression::StaticMemberExpression(member) => styled_call_base(&member.object, imports),
        _ => None,
    }
}

fn identifier_name<'a>(expression: &'a Expression<'_>) -> Option<&'a str> {
    match expression {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}

/// Own attrs override the base attrs, like a spread of both objects
pub(super) fn merge_attrs(base: Option<&str>, own: Option<String>) -> Option<String> {
    match (base, own) {
        (Some(base), Some(own)) => Some(format!("{{ ...{base}, ...{own} }}")),
        (base, own) => own.or_else(|| base.map(str::to_owned)),
    }
}

pub(super) struct AttrsHoisting<'a> {
    pub program: &'a Program<'a>,
    pub scoping: &'a Scoping,
    pub file_path: &'a str,
    pub source: &'a str,
    /// Where the generated constant is inserted, before the styled component's statement
    pub statement_start: u32,
}

/// Declares `attrs` in a generated constant before the styled component and returns its name
pub(super) fn hoist_attrs(
    variable_name: &str,
    attrs: &str,
    hoisting: &AttrsHoisting<'_>,
    edits: &mut Vec<Edit>,
) -> Result<String, CompilerDiagnostic> {
    let name = format!("_v{variable_name}Attrs");
    reserved_name_error(
        hoisting.program,
        hoisting.scoping,
        &name,
        hoisting.file_path,
        hoisting.source,
    )?;
    edits.push(Edit {
        span: oxc_span::Span::new(hoisting.statement_start, hoisting.statement_start),
        replacement: format!("const {name} = {attrs};\n"),
    });
    Ok(name)
}
