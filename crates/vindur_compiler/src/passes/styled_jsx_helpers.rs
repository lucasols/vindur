use oxc_ast::ast::{
    AssignmentExpression, AwaitExpression, CallExpression, Expression, JSXAttribute,
    JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXElement, NewExpression,
    TaggedTemplateExpression, UnaryExpression, UnaryOperator, UpdateExpression,
};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::Scoping;
use oxc_span::{GetSpan, Span};
use rustc_hash::FxHashMap;

use crate::edit::Edit;

use super::{
    jsx_class_name::{ClassNameSources, class_name_concat_source},
    static_evaluation::resolved_constant,
    styled::{StyleFlag, StyleFlagKind, StyledComponent},
};

pub(super) fn css_attribute_is_compile_time(
    attribute: &oxc_ast::ast::JSXAttribute<'_>,
    constants: &FxHashMap<String, crate::facts::StaticValue>,
    scoping: &Scoping,
) -> bool {
    let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
        return true;
    };
    match &container.expression {
        oxc_ast::ast::JSXExpression::Identifier(identifier) => matches!(
            resolved_constant(identifier, constants, scoping),
            Some(crate::facts::StaticValue::CssClass { .. })
        ),
        oxc_ast::ast::JSXExpression::TemplateLiteral(_) => true,
        _ => false,
    }
}

pub(super) struct DynamicFlagClass {
    pub(super) concat: String,
}

pub(super) fn collect_flag_class(
    attribute: &oxc_ast::ast::JSXAttribute<'_>,
    flag: &StyleFlag,
    source: &str,
    static_classes: &mut Vec<String>,
    dynamic_classes: &mut Vec<DynamicFlagClass>,
) {
    match &flag.kind {
        StyleFlagKind::Boolean => match &attribute.value {
            None => static_classes.push(flag.hashed_class_name.clone()),
            Some(JSXAttributeValue::StringLiteral(value)) => {
                if !value.value.is_empty() {
                    static_classes.push(flag.hashed_class_name.clone());
                }
            }
            Some(JSXAttributeValue::ExpressionContainer(container)) => {
                match &container.expression {
                    oxc_ast::ast::JSXExpression::BooleanLiteral(value) => {
                        if value.value {
                            static_classes.push(flag.hashed_class_name.clone());
                        }
                    }
                    expression => {
                        let span = expression.span();
                        let expression_source = &source[span.start as usize..span.end as usize];
                        dynamic_classes.push(DynamicFlagClass {
                            concat: format!(
                                " + (({expression_source}) ? \" {}\" : \"\")",
                                flag.hashed_class_name
                            ),
                        });
                    }
                }
            }
            _ => {}
        },
        StyleFlagKind::StringUnion(_) => match &attribute.value {
            Some(JSXAttributeValue::StringLiteral(value)) => {
                static_classes.push(format!("{}-{}", flag.hashed_class_name, value.value))
            }
            Some(JSXAttributeValue::ExpressionContainer(container)) => {
                match &container.expression {
                    oxc_ast::ast::JSXExpression::StringLiteral(value) => {
                        static_classes.push(format!("{}-{}", flag.hashed_class_name, value.value))
                    }
                    expression => {
                        let span = expression.span();
                        let expression_source = &source[span.start as usize..span.end as usize];
                        dynamic_classes.push(DynamicFlagClass {
                            concat: format!(
                                " + (({expression_source}) ? \" {}-\" + ({expression_source}) : \"\")",
                                flag.hashed_class_name
                            ),
                        });
                    }
                }
            }
            _ => {}
        },
    }
}

/// String union flag values are read twice in the emitted class, so they must have no side
/// effects. Returns the flag name and the span of the first expression that may have one
pub(super) fn side_effect_in_string_flag_value<'f>(
    element: &JSXElement<'_>,
    component: &'f StyledComponent,
) -> Option<(&'f str, Span)> {
    element.opening_element.attributes.iter().find_map(|item| {
        let JSXAttributeItem::Attribute(attribute) = item else {
            return None;
        };
        let JSXAttributeName::Identifier(name) = &attribute.name else {
            return None;
        };
        let flag = component.style_flags.iter().find(|flag| {
            flag.prop_name == name.name.as_str()
                && matches!(flag.kind, StyleFlagKind::StringUnion(_))
        })?;
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
            return None;
        };
        let expression = container.expression.as_expression()?;
        let mut finder = SideEffectFinder { found: None };
        finder.visit_expression(expression);
        finder.found.map(|span| (flag.prop_name.as_str(), span))
    })
}

struct SideEffectFinder {
    found: Option<Span>,
}

impl<'a> Visit<'a> for SideEffectFinder {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        self.found.get_or_insert(call.span);
    }

    fn visit_new_expression(&mut self, new: &NewExpression<'a>) {
        self.found.get_or_insert(new.span);
    }

    fn visit_assignment_expression(&mut self, assignment: &AssignmentExpression<'a>) {
        self.found.get_or_insert(assignment.span);
    }

    fn visit_update_expression(&mut self, update: &UpdateExpression<'a>) {
        self.found.get_or_insert(update.span);
    }

    fn visit_await_expression(&mut self, await_expression: &AwaitExpression<'a>) {
        self.found.get_or_insert(await_expression.span);
    }

    fn visit_tagged_template_expression(&mut self, tagged: &TaggedTemplateExpression<'a>) {
        self.found.get_or_insert(tagged.span);
    }

    fn visit_unary_expression(&mut self, unary: &UnaryExpression<'a>) {
        if unary.operator == UnaryOperator::Delete {
            self.found.get_or_insert(unary.span);
        } else {
            walk::walk_unary_expression(self, unary);
        }
    }
}

/// The classes of the style flag props set on a compiled styled component
pub(super) struct StyleFlagClasses {
    pub(super) attribute_spans: Vec<oxc_span::Span>,
    pub(super) static_classes: Vec<String>,
    pub(super) dynamic_classes: Vec<DynamicFlagClass>,
}

impl StyleFlagClasses {
    /// Concatenates the classes of the flags with a runtime value
    pub(super) fn dynamic_suffix(&self) -> String {
        self.dynamic_classes
            .iter()
            .map(|class| class.concat.as_str())
            .collect()
    }
}

pub(super) fn style_flag_classes(
    element: &JSXElement<'_>,
    component: &StyledComponent,
    source: &str,
) -> StyleFlagClasses {
    let mut classes = StyleFlagClasses {
        attribute_spans: Vec::new(),
        static_classes: Vec::new(),
        dynamic_classes: Vec::new(),
    };
    for item in &element.opening_element.attributes {
        let JSXAttributeItem::Attribute(attribute) = item else {
            continue;
        };
        let JSXAttributeName::Identifier(name) = &attribute.name else {
            continue;
        };
        let Some(flag) = component
            .style_flags
            .iter()
            .find(|flag| flag.prop_name == name.name.as_str())
        else {
            continue;
        };
        classes.attribute_spans.push(attribute.span);
        collect_flag_class(
            attribute,
            flag,
            source,
            &mut classes.static_classes,
            &mut classes.dynamic_classes,
        );
    }
    classes
}

/// The classes a compiled styled component adds to the className emitted for its css or
/// cx prop. With a `dynamicColor` prop the dynamic color pass adds the style flag classes
pub(super) struct InlinedComponentClasses {
    pub(super) literal: String,
    pub(super) flag_suffix: String,
}

pub(super) fn inlined_component_classes(
    element: &JSXElement<'_>,
    component: &StyledComponent,
    source: &str,
) -> InlinedComponentClasses {
    if has_dynamic_color_attribute(element) {
        return InlinedComponentClasses {
            literal: component.class_name.clone(),
            flag_suffix: String::new(),
        };
    }
    let flags = style_flag_classes(element, component, source);
    InlinedComponentClasses {
        literal: std::iter::once(component.class_name.as_str())
            .chain(flags.static_classes.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join(" "),
        flag_suffix: flags.dynamic_suffix(),
    }
}

/// `literal` followed by the classes of dynamic style flags and a cx call
pub(super) fn class_concat(literal: &str, flag_suffix: &str, cx_call: Option<&str>) -> String {
    match (flag_suffix.is_empty(), cx_call) {
        (true, None) => js_string_literal(literal),
        (true, Some(cx_call)) => {
            format!("{} + {cx_call}", js_string_literal(&format!("{literal} ")))
        }
        (false, None) => format!("{}{flag_suffix}", js_string_literal(literal)),
        (false, Some(cx_call)) => {
            format!(
                "{}{flag_suffix} + \" \" + {cx_call}",
                js_string_literal(literal)
            )
        }
    }
}

pub(super) fn class_name_expression(
    attribute: &oxc_ast::ast::JSXAttribute<'_>,
    styled_class_name: &str,
    static_classes: &[String],
    sources: &ClassNameSources<'_>,
) -> String {
    let static_suffix = static_classes
        .iter()
        .map(|class| format!(" {class}"))
        .collect::<String>();
    match &attribute.value {
        Some(JSXAttributeValue::StringLiteral(value)) => js_string_literal(&format!(
            "{styled_class_name} {}{static_suffix}",
            decode_jsx_entities(&value.value)
        )),
        Some(JSXAttributeValue::ExpressionContainer(_)) => {
            let existing = class_name_concat_source(attribute, sources);
            if static_suffix.is_empty() {
                format!("\"{styled_class_name} \" + {existing}")
            } else {
                format!(
                    "\"{styled_class_name} \" + {existing} + {}",
                    js_string_literal(&static_suffix)
                )
            }
        }
        _ => js_string_literal(&format!("{styled_class_name}{static_suffix}")),
    }
}

pub(super) fn has_spread_attribute(element: &JSXElement<'_>) -> bool {
    element
        .opening_element
        .attributes
        .iter()
        .any(|item| matches!(item, JSXAttributeItem::SpreadAttribute(_)))
}

pub(super) fn has_dynamic_color_attribute(element: &JSXElement<'_>) -> bool {
    element.opening_element.attributes.iter().any(|item| {
        matches!(item, JSXAttributeItem::Attribute(attribute) if is_named_attribute(attribute, "dynamicColor"))
    })
}

pub(super) enum ClassNameTarget {
    /// Replace an existing attribute with the merged className
    Replace(oxc_span::Span),
    /// Insert the merged className at an offset of the opening element
    Insert(u32),
}

/// Emits the merged className expression of an element. Elements with a `dynamicColor` prop
/// hand it to the dynamic color pass instead, which merges it into the `_sp` call
pub(super) fn emit_class_name(
    edits: &mut Vec<Edit>,
    class_expressions: &mut FxHashMap<u32, String>,
    element: &JSXElement<'_>,
    target: ClassNameTarget,
    expression: String,
) {
    if has_dynamic_color_attribute(element) {
        if let ClassNameTarget::Replace(span) = target {
            edits.push(Edit {
                span,
                replacement: String::new(),
            });
        }
        class_expressions.insert(element.span.start, expression);
        return;
    }
    edits.push(match target {
        ClassNameTarget::Replace(span) => Edit {
            span,
            replacement: format!("className={{{expression}}}"),
        },
        ClassNameTarget::Insert(offset) => Edit {
            span: oxc_span::Span::new(offset, offset),
            replacement: format!(" className={{{expression}}}"),
        },
    });
}

pub(super) struct InvalidStyledSpread {
    pub(super) span: oxc_span::Span,
    pub(super) source: String,
}

/// Only references to variables can be spread on elements vindur merges the className of
pub(super) fn validate_styled_spreads(
    element: &JSXElement<'_>,
    source: &str,
) -> Result<(), InvalidStyledSpread> {
    for item in &element.opening_element.attributes {
        let JSXAttributeItem::SpreadAttribute(spread) = item else {
            continue;
        };
        if !matches!(&spread.argument, Expression::Identifier(_)) {
            let span = spread.argument.span();
            return Err(InvalidStyledSpread {
                span: spread.span,
                source: source[span.start as usize..span.end as usize].to_owned(),
            });
        }
    }
    Ok(())
}

pub(super) fn is_named_attribute(attribute: &JSXAttribute<'_>, expected: &str) -> bool {
    let JSXAttributeName::Identifier(name) = &attribute.name else {
        return false;
    };
    name.name.as_str() == expected
}

pub(super) fn unsupported_spread_message(spread: &InvalidStyledSpread, used_in: &str) -> String {
    format!(
        "Unsupported spread expression \"{}\" used in {used_in}. Only references to variables are allowed in spread expressions. Extract them to a variable and use that variable in the spread expression.",
        format_spread_expression(&spread.source)
    )
}

pub(super) fn format_spread_expression(source: &str) -> String {
    let source = source
        .trim()
        .strip_prefix('(')
        .and_then(|value| value.strip_suffix(')'))
        .unwrap_or(source.trim());
    source.replace("{ ", "{\n  ").replace(" }", "\n}")
}

/// Whether a generated CSS rule is the root rule of `class_name`, including `@layer` sections
pub(super) fn is_class_rule(rule: &str, class_name: &str) -> bool {
    let selector = format!(".{class_name} {{");
    rule.starts_with(&selector)
        || rule
            .strip_prefix("@layer ")
            .and_then(|layered| layered.split_once(" {\n  "))
            .is_some_and(|(_, inner)| inner.starts_with(&selector))
}

/// Rewrites a JSX attribute string keeping its raw content and quotes, so entities still work
pub(super) fn wrap_jsx_string(
    value: &oxc_ast::ast::StringLiteral<'_>,
    source: &str,
    prefix: &str,
    suffix: &str,
) -> String {
    let raw = &source[value.span.start as usize..value.span.end as usize];
    let quote = &raw[..1];
    let content = &raw[1..raw.len() - 1];
    format!("{quote}{prefix}{content}{suffix}{quote}")
}

/// Serializes a value as a double-quoted JS string literal
pub(super) fn js_string_literal(value: &str) -> String {
    let mut literal = String::with_capacity(value.len() + 2);
    literal.push('"');
    for character in value.chars() {
        match character {
            '"' => literal.push_str("\\\""),
            '\\' => literal.push_str("\\\\"),
            '\n' => literal.push_str("\\n"),
            '\r' => literal.push_str("\\r"),
            '\u{2028}' => literal.push_str("\\u2028"),
            '\u{2029}' => literal.push_str("\\u2029"),
            character => literal.push(character),
        }
    }
    literal.push('"');
    literal
}

/// Decodes the HTML entities of a JSX attribute string, e.g. `&quot;`, `&#34;` or `&#x22;`
pub(super) fn decode_jsx_entities(value: &str) -> String {
    let mut decoded = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find('&') {
        decoded.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after
            .find(';')
            .and_then(|end| decode_jsx_entity(&after[..end]).map(|character| (character, end)))
        {
            Some((character, end)) => {
                decoded.push(character);
                rest = &after[end + 1..];
            }
            None => {
                decoded.push('&');
                rest = after;
            }
        }
    }
    decoded.push_str(rest);
    decoded
}

fn decode_jsx_entity(entity: &str) -> Option<char> {
    let Some(number) = entity.strip_prefix('#') else {
        return oxc_syntax::xml_entities::XML_ENTITIES.get(entity).copied();
    };
    let code = match number.strip_prefix('x') {
        Some(hex) if !hex.is_empty() && hex.bytes().all(|byte| byte.is_ascii_hexdigit()) => {
            u32::from_str_radix(hex, 16).ok()?
        }
        None if !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit()) => {
            number.parse().ok()?
        }
        _ => return None,
    };
    char::from_u32(code)
}
