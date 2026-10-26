use oxc_ast::ast::{JSXAttribute, JSXAttributeItem, JSXAttributeValue, JSXElement, JSXExpression};
use oxc_semantic::Scoping;
use oxc_span::{GetSpan, Span};
use rustc_hash::FxHashMap;

use crate::{
    edit::{Edit, take_edited_source},
    facts::StaticValue,
};

use super::{
    static_evaluation::resolved_constant,
    styled_jsx_helpers::{
        ClassNameTarget, decode_jsx_entities, emit_class_name, has_dynamic_color_attribute,
        is_named_attribute, js_string_literal,
    },
};

pub(super) enum ClassNameMerge<'a> {
    // No later spread can override the last explicit className, so vindur's
    // classes are merged into it in place
    InPlace(&'a JSXAttribute<'a>),
    // A later spread may set className, so the classes are merged at runtime
    Runtime,
    // No className or spreads, so a new className is added
    Insert,
}

pub(super) fn class_name_merge<'a>(element: &'a JSXElement<'a>) -> ClassNameMerge<'a> {
    let attributes = &element.opening_element.attributes;
    let last_spread = attributes
        .iter()
        .rposition(|item| matches!(item, JSXAttributeItem::SpreadAttribute(_)));
    let last_class_name = attributes
        .iter()
        .enumerate()
        .rev()
        .find_map(|(index, item)| {
            let JSXAttributeItem::Attribute(attribute) = item else {
                return None;
            };
            is_named_attribute(attribute, "className").then_some((index, &**attribute))
        });
    match (last_spread, last_class_name) {
        (Some(spread), Some((index, attribute))) if index > spread => {
            ClassNameMerge::InPlace(attribute)
        }
        (Some(_), _) => ClassNameMerge::Runtime,
        (None, Some((_, attribute))) => ClassNameMerge::InPlace(attribute),
        (None, None) => ClassNameMerge::Insert,
    }
}

/// What the className values are read with
pub(super) struct ClassNameSources<'a> {
    pub(super) source: &'a str,
    pub(super) constants: &'a FxHashMap<String, StaticValue>,
    pub(super) scoping: &'a Scoping,
}

/// The text around a className expression concatenated with vindur class names, guarding values
/// that can be falsy at runtime, e.g. an optional `className` prop
fn concat_guard(
    expression: &JSXExpression<'_>,
    sources: &ClassNameSources<'_>,
) -> (&'static str, &'static str) {
    match expression {
        JSXExpression::Identifier(identifier)
            if matches!(
                resolved_constant(identifier, sources.constants, sources.scoping),
                Some(StaticValue::CssClass { .. } | StaticValue::String(_))
            ) =>
        {
            ("", "")
        }
        JSXExpression::StringLiteral(_) | JSXExpression::TemplateLiteral(_) => ("", ""),
        // Operands that bind tighter than `||` don't need to be parenthesized
        JSXExpression::Identifier(_)
        | JSXExpression::StaticMemberExpression(_)
        | JSXExpression::ComputedMemberExpression(_)
        | JSXExpression::CallExpression(_) => ("(", " || \"\")"),
        _ => ("((", ") || \"\")"),
    }
}

/// The value of an expression container that isn't empty
fn class_expression<'a>(attribute: &'a JSXAttribute<'a>) -> Option<&'a JSXExpression<'a>> {
    let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
        return None;
    };
    (!matches!(container.expression, JSXExpression::EmptyExpression(_)))
        .then_some(&container.expression)
}

/// Returns the existing className expression to be concatenated with vindur class names
pub(super) fn class_name_concat_source(
    attribute: &JSXAttribute<'_>,
    sources: &ClassNameSources<'_>,
) -> String {
    concat_source(attribute, sources, |span| {
        sources.source[span.start as usize..span.end as usize].to_owned()
    })
}

/// Like `class_name_concat_source`, with the edits other passes made inside the expression, which
/// are taken out of `edits`
pub(super) fn edited_class_name_concat_source(
    attribute: &JSXAttribute<'_>,
    sources: &ClassNameSources<'_>,
    edits: &mut Vec<Edit>,
) -> String {
    concat_source(attribute, sources, |span| {
        take_edited_source(sources.source, span, edits)
    })
}

fn concat_source(
    attribute: &JSXAttribute<'_>,
    sources: &ClassNameSources<'_>,
    expression_source: impl FnOnce(Span) -> String,
) -> String {
    if let Some(JSXAttributeValue::StringLiteral(value)) = &attribute.value {
        return js_string_literal(&decode_jsx_entities(&value.value));
    }
    let Some(expression) = class_expression(attribute) else {
        return "\"\"".to_owned();
    };
    let (open, close) = concat_guard(expression, sources);
    format!("{open}{}{close}", expression_source(expression.span()))
}

/// Merges vindur class names into an existing className expression in place, as
/// `{before}{class_name_concat_source}{after}`. Only the text around the expression is replaced,
/// so edits other passes make inside it still apply. Returns `None` for strings and empty values
pub(super) fn wrap_class_concat(
    attribute: &JSXAttribute<'_>,
    sources: &ClassNameSources<'_>,
    before: &str,
    after: &str,
) -> Option<[Edit; 2]> {
    let (open, close) = concat_guard(class_expression(attribute)?, sources);
    wrap_class_expression(
        attribute,
        &format!("{before}{open}"),
        &format!("{close}{after}"),
    )
}

/// Replaces an existing className expression with `{prefix}expression{suffix}`, editing only the
/// text around it, so edits other passes make inside it still apply
pub(super) fn wrap_class_expression(
    attribute: &JSXAttribute<'_>,
    prefix: &str,
    suffix: &str,
) -> Option<[Edit; 2]> {
    let span = class_expression(attribute)?.span();
    Some([
        Edit {
            span: Span::new(attribute.span.start, span.start),
            replacement: format!("className={{{prefix}"),
        },
        Edit {
            span: Span::new(span.end, attribute.span.end),
            replacement: format!("{suffix}}}"),
        },
    ])
}

/// Replaces an existing className expression with `{before}{class_name_concat_source}{after}`,
/// keeping the edits other passes made inside it. Elements with a `dynamicColor` prop hand the
/// merged expression to the dynamic color pass, see `emit_class_name`
pub(super) fn emit_class_concat(
    edits: &mut Vec<Edit>,
    class_expressions: &mut FxHashMap<u32, String>,
    element: &JSXElement<'_>,
    attribute: &JSXAttribute<'_>,
    sources: &ClassNameSources<'_>,
    before: &str,
    after: &str,
) {
    if !has_dynamic_color_attribute(element)
        && let Some(wrap) = wrap_class_concat(attribute, sources, before, after)
    {
        edits.extend(wrap);
        return;
    }
    let existing = edited_class_name_concat_source(attribute, sources, edits);
    emit_class_name(
        edits,
        class_expressions,
        element,
        ClassNameTarget::Replace(attribute.span),
        format!("{before}{existing}{after}"),
    );
}

/// `mergeClassNames` inputs: spread props and explicit `className` values in source order, with
/// the edits other passes made inside them, plus the spans of the `className` attributes they
/// replace
pub(super) fn merge_class_name_inputs(
    element: &JSXElement<'_>,
    sources: &ClassNameSources<'_>,
    edits: &mut Vec<Edit>,
) -> (Vec<String>, Vec<Span>) {
    let mut inputs = Vec::new();
    let mut replaced_attributes = Vec::new();
    for item in &element.opening_element.attributes {
        match item {
            JSXAttributeItem::SpreadAttribute(spread) => {
                let span = spread.argument.span();
                inputs.push(sources.source[span.start as usize..span.end as usize].to_owned());
            }
            JSXAttributeItem::Attribute(attribute)
                if is_named_attribute(attribute, "className") =>
            {
                inputs.push(edited_class_name_concat_source(attribute, sources, edits));
                replaced_attributes.push(attribute.span);
            }
            JSXAttributeItem::Attribute(_) => {}
        }
    }
    (inputs, replaced_attributes)
}
