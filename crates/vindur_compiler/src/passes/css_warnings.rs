use oxc_ast::ast::{Expression, Program, TemplateLiteral};
use oxc_ast_visit::{Visit, walk};
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use crate::{CompilerDiagnostic, facts::StaticValue};

pub(crate) fn css_extension_warnings(
    program: &Program<'_>,
    constants: &FxHashMap<String, StaticValue>,
    _file_path: &str,
    source: &str,
) -> Vec<CompilerDiagnostic> {
    let mut visitor = CssExtensionWarningVisitor {
        constants,
        source,
        warnings: Vec::new(),
    };
    visitor.visit_program(program);
    visitor.warnings
}

struct CssExtensionWarningVisitor<'a> {
    constants: &'a FxHashMap<String, StaticValue>,
    source: &'a str,
    warnings: Vec<CompilerDiagnostic>,
}

impl<'a> Visit<'a> for CssExtensionWarningVisitor<'_> {
    fn visit_tagged_template_expression(
        &mut self,
        tagged: &oxc_ast::ast::TaggedTemplateExpression<'a>,
    ) {
        for (index, expression) in tagged.quasi.expressions.iter().enumerate() {
            let Expression::Identifier(identifier) = expression else {
                continue;
            };
            if !matches!(
                self.constants.get(identifier.name.as_str()),
                Some(StaticValue::CssClass { .. })
            ) || !likely_missing_extension_semicolon(&tagged.quasi, index)
            {
                continue;
            }
            let name = identifier.name.as_str();
            self.warnings.push(CompilerDiagnostic::warning(
                "",
                self.source,
                expression.span(),
                format!(
                    "Possible missing `;` after `${{{name}}}`. CSS interpolations are treated as selectors unless they are followed by `;`, so use `${{{name}}};` when extending styles."
                ),
            ));
        }
        walk::walk_tagged_template_expression(self, tagged);
    }
}

fn likely_missing_extension_semicolon(template: &TemplateLiteral<'_>, index: usize) -> bool {
    let Some(next) = template.quasis.get(index + 1) else {
        return false;
    };
    let next = next
        .value
        .cooked
        .as_ref()
        .unwrap_or(&next.value.raw)
        .as_str();
    if next.trim_start().starts_with(';') {
        return false;
    }
    let remaining = template.quasis.iter().skip(index + 1).map(|quasi| {
        quasi
            .value
            .cooked
            .as_ref()
            .unwrap_or(&quasi.value.raw)
            .as_str()
    });
    let parts = remaining.collect::<Vec<_>>();
    let Some(first) = parts
        .iter()
        .map(|part| part.trim_start())
        .find(|part| !part.is_empty())
    else {
        return index + 1 == template.expressions.len();
    };
    if first.starts_with(':') || !starts_with_property_declaration(first) {
        return false;
    }
    for character in parts.iter().flat_map(|part| part.chars()) {
        match character {
            ';' => return true,
            '{' => return false,
            _ => {}
        }
    }
    true
}

fn starts_with_property_declaration(value: &str) -> bool {
    let Some(colon) = value.find(':') else {
        return false;
    };
    let name = value[..colon].trim_end();
    !name.is_empty()
        && name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
}
