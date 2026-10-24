use oxc_ast::ast::{
    Argument, Expression, IdentifierReference, JSXAttribute, JSXAttributeItem, JSXAttributeName,
    JSXAttributeValue, JSXElement, JSXExpression, Program,
};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::Scoping;
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use crate::{
    CompilerDiagnostic,
    edit::{Edit, take_edited_source},
    facts::StaticValue,
};

use super::{
    jsx_attributes::{
        find_attribute, find_last_attribute, jsx_name, opening_attribute_insertion_offset,
    },
    jsx_class_name::{
        explicit_class_input, js_string_literal, jsx_string_literal, jsx_string_value,
    },
    jsx_cx_attribute::{
        is_component_name, is_foreign_cx_attribute, is_foreign_styled_cx_attribute,
    },
    runtime_helpers::RuntimeHelperNames,
    static_evaluation::resolved_constant,
    styled::StyledComponent,
};

pub(super) struct DynamicColorTransform<'a> {
    pub constants: &'a FxHashMap<String, StaticValue>,
    pub scoping: &'a Scoping,
    pub imported_values: &'a FxHashMap<String, StaticValue>,
    pub edits: &'a mut Vec<Edit>,
    pub file_path: &'a str,
    pub source: &'a str,
    pub styled_components: &'a FxHashMap<String, StyledComponent>,
    pub needs_merge_class_names: &'a mut bool,
    pub needs_merge_styles: &'a mut bool,
    pub helper_names: &'a RuntimeHelperNames,
}

pub(super) fn transform_dynamic_color_props(
    program: &Program<'_>,
    output: DynamicColorTransform<'_>,
) -> Result<(), CompilerDiagnostic> {
    let mut visitor = DynamicColorVisitor {
        output,
        diagnostic: None,
    };
    visitor.visit_program(program);
    visitor.diagnostic.map_or(Ok(()), Err)
}

struct DynamicColorVisitor<'a> {
    output: DynamicColorTransform<'a>,
    diagnostic: Option<CompilerDiagnostic>,
}

impl<'a> Visit<'a> for DynamicColorVisitor<'_> {
    fn visit_jsx_element(&mut self, element: &JSXElement<'a>) {
        if self.diagnostic.is_some() {
            return;
        }
        if let Some(attribute) = find_attribute(element, "dynamicColor") {
            self.transform_attribute(element, attribute);
        }
        if self.diagnostic.is_none() {
            walk::walk_jsx_element(self, element);
        }
    }
}

impl DynamicColorVisitor<'_> {
    fn transform_attribute(&mut self, element: &JSXElement<'_>, attribute: &JSXAttribute<'_>) {
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
            self.error(
                attribute.span,
                "dynamicColor prop must be an expression".to_owned(),
            );
            return;
        };
        let Some(colors) = self.color_expressions(&container.expression) else {
            if let Some(message) = self.conditional_error_message(&container.expression) {
                self.error(container.expression.span(), message);
                return;
            }
            self.error(
                container.expression.span(),
                "dynamicColor prop must reference a dynamic color or color.set(...)".to_owned(),
            );
            return;
        };
        let component = jsx_name(&element.opening_element.name)
            .and_then(|name| self.output.styled_components.get(name));
        if let Some(component) = component
            && !component.runtime
        {
            self.output.edits.push(Edit {
                span: element.opening_element.name.span(),
                replacement: component.element.clone(),
            });
            if let Some(closing) = &element.closing_element {
                self.output.edits.push(Edit {
                    span: closing.name.span(),
                    replacement: component.element.clone(),
                });
            }
        }

        let class_attribute = find_last_attribute(element, "className");
        let style_attribute = find_last_attribute(element, "style");
        let spreads = spread_sources(element, self.output.source);
        let preserve_native_attributes = component.is_none()
            && spreads.is_empty()
            && colors.iter().all(|color| {
                matches!(
                    self.output.imported_values.get(&color.name),
                    Some(StaticValue::DynamicColor { .. })
                )
            });
        if !preserve_native_attributes
            && let Some(class_attribute) = class_attribute
            && has_class_merging_prop(element, component)
        {
            self.error(
                class_attribute.span,
                "dynamicColor can't be combined with both className and the css or cx prop on the same element"
                    .to_owned(),
            );
            return;
        }
        if !preserve_native_attributes {
            for item in &element.opening_element.attributes {
                let JSXAttributeItem::Attribute(other) = item else {
                    continue;
                };
                let JSXAttributeName::Identifier(name) = &other.name else {
                    continue;
                };
                if matches!(name.name.as_str(), "className" | "style") {
                    self.output.edits.push(Edit {
                        span: other.span,
                        replacement: String::new(),
                    });
                }
            }
        }

        let base_class = component.map(|component| component.class_name.as_str());
        let merge = if preserve_native_attributes
            && (class_attribute.is_some() || style_attribute.is_some())
        {
            Some("{}".to_owned())
        } else {
            color_merge_object(
                base_class,
                class_attribute,
                style_attribute,
                &spreads,
                &mut self.output,
            )
        };
        let call = colors.iter().rev().fold(merge, |inner, color| {
            let suffix = inner.map_or(String::new(), |value| format!(", {value}"));
            Some(format!("{}._sp({}{suffix})", color.name, color.value))
        });
        let Some(call) = call else {
            return;
        };
        if spreads.is_empty() {
            self.output.edits.push(Edit {
                span: attribute.span,
                replacement: String::new(),
            });
            let offset = opening_attribute_insertion_offset(element, self.output.source);
            self.output.edits.push(Edit {
                span: oxc_span::Span::new(offset, offset),
                replacement: format!(" {{...{call}}}"),
            });
        } else {
            let mut trailing_props = Vec::new();
            for item in &element.opening_element.attributes {
                let JSXAttributeItem::Attribute(other) = item else {
                    continue;
                };
                if other.span.start <= attribute.span.start {
                    continue;
                }
                let JSXAttributeName::Identifier(name) = &other.name else {
                    continue;
                };
                if name.name.as_str().starts_with("on")
                    || matches!(name.name.as_str(), "className" | "style")
                {
                    continue;
                }
                trailing_props.push(
                    self.output.source[other.span.start as usize..other.span.end as usize]
                        .to_owned(),
                );
                self.output.edits.push(Edit {
                    span: other.span,
                    replacement: String::new(),
                });
            }
            let prefix = if trailing_props.is_empty() {
                String::new()
            } else {
                format!("{} ", trailing_props.join(" "))
            };
            self.output.edits.push(Edit {
                span: attribute.span,
                replacement: format!("{prefix}{{...{call}}}"),
            });
        }
    }

    fn conditional_error_message(&self, expression: &JSXExpression<'_>) -> Option<String> {
        let (condition, call, alternate) = match expression {
            JSXExpression::ConditionalExpression(conditional) => (
                expression_source(&conditional.test, self.output.source),
                &conditional.consequent,
                expression_source(&conditional.alternate, self.output.source),
            ),
            JSXExpression::LogicalExpression(logical) => (
                expression_source(&logical.left, self.output.source),
                &logical.right,
                "null".to_owned(),
            ),
            _ => return None,
        };
        let Expression::CallExpression(call) = call else {
            return None;
        };
        let Expression::StaticMemberExpression(callee) = &call.callee else {
            return None;
        };
        if callee.property.name.as_str() != "set" {
            return None;
        }
        let Expression::Identifier(color) = &callee.object else {
            return None;
        };
        let argument = call.arguments.first()?;
        let argument_source = expression_source(argument, self.output.source);
        Some(format!(
            "Conditional dynamicColor is not supported. Use condition inside the set function instead: {}.set({condition} ? {argument_source} : {alternate})",
            color.name
        ))
    }

    fn color_expressions(&self, expression: &JSXExpression<'_>) -> Option<Vec<ColorExpression>> {
        match expression {
            JSXExpression::Identifier(identifier) => self.identifier_color(identifier),
            JSXExpression::CallExpression(call) => self.call_color(call),
            JSXExpression::ArrayExpression(array) => array
                .elements
                .iter()
                .map(|element| {
                    let expression = element.as_expression()?;
                    match expression {
                        Expression::Identifier(identifier) => self.identifier_color(identifier),
                        Expression::CallExpression(call) => self.call_color(call),
                        _ => None,
                    }
                })
                .collect::<Option<Vec<_>>>()
                .map(|groups| groups.into_iter().flatten().collect()),
            _ => None,
        }
    }

    fn identifier_color(
        &self,
        identifier: &IdentifierReference<'_>,
    ) -> Option<Vec<ColorExpression>> {
        matches!(
            resolved_constant(identifier, self.output.constants, self.output.scoping),
            Some(StaticValue::DynamicColor { .. })
        )
        .then(|| {
            vec![ColorExpression {
                name: identifier.name.to_string(),
                value: "\"#ff6b6b\"".to_owned(),
            }]
        })
    }

    fn call_color(&self, call: &oxc_ast::ast::CallExpression<'_>) -> Option<Vec<ColorExpression>> {
        let Expression::StaticMemberExpression(callee) = &call.callee else {
            return None;
        };
        if callee.property.name.as_str() != "set" {
            return None;
        }
        let Expression::Identifier(color) = &callee.object else {
            return None;
        };
        if !matches!(
            resolved_constant(color, self.output.constants, self.output.scoping),
            Some(StaticValue::DynamicColor { .. })
        ) {
            return None;
        }
        let [Argument::StringLiteral(value)] = call.arguments.as_slice() else {
            let [argument] = call.arguments.as_slice() else {
                return None;
            };
            let span = argument.span();
            return Some(vec![ColorExpression {
                name: color.name.to_string(),
                value: self.output.source[span.start as usize..span.end as usize].to_owned(),
            }]);
        };
        Some(vec![ColorExpression {
            name: color.name.to_string(),
            value: format!("\"{}\"", value.value),
        }])
    }

    fn error(&mut self, span: oxc_span::Span, message: String) {
        self.diagnostic = Some(CompilerDiagnostic::error(
            self.output.file_path,
            self.output.source,
            span,
            message,
        ));
    }
}

struct ColorExpression {
    name: String,
    value: String,
}

fn color_merge_object(
    base_class: Option<&str>,
    class_attribute: Option<&JSXAttribute<'_>>,
    style_attribute: Option<&JSXAttribute<'_>>,
    spreads: &[SpreadSource],
    output: &mut DynamicColorTransform<'_>,
) -> Option<String> {
    let source = output.source;
    let mut sources = AttributeSources {
        source,
        edits: &mut *output.edits,
    };
    let last_spread_start = spreads.last().map_or(0, |spread| spread.start);
    let spread_names = spreads
        .iter()
        .map(|spread| spread.source.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    let class_after_spreads = class_attribute
        .is_some_and(|attribute| spreads.is_empty() || attribute.span.start > last_spread_start);
    let style_after_spreads = style_attribute
        .is_some_and(|attribute| spreads.is_empty() || attribute.span.start > last_spread_start);
    let class_name = if !spreads.is_empty() && !class_after_spreads {
        *output.needs_merge_class_names = true;
        // The explicit className and the spreads after it, in source order,
        // for `mergeClassNames`' last-one-wins semantics
        let class_start = class_attribute.map_or(0, |attribute| attribute.span.start);
        let inputs = class_attribute
            .map(|attribute| explicit_class_input(attribute, source))
            .into_iter()
            .chain(
                spreads
                    .iter()
                    .filter(|spread| spread.start > class_start)
                    .map(|spread| spread.source.clone()),
            )
            .collect::<Vec<_>>();
        Some(format!(
            "{}([{}], \"{}\")",
            output.helper_names.merge_class_names,
            inputs.join(", "),
            base_class.unwrap_or_default()
        ))
    } else {
        match (base_class, class_attribute) {
            (None, None) => None,
            (Some(base), None) => Some(format!("\"{base}\"")),
            (None, Some(attribute)) => Some(sources.value(attribute)),
            (Some(base), Some(attribute)) => match &attribute.value {
                Some(JSXAttributeValue::StringLiteral(value)) => Some(js_string_literal(&format!(
                    "{base} {}",
                    jsx_string_value(&value.value)
                ))),
                _ => Some(format!(
                    "[\"{base}\", {}].filter(Boolean).join(\" \")",
                    sources.value(attribute)
                )),
            },
        }
    };
    let style = if !spreads.is_empty() && !style_after_spreads {
        *output.needs_merge_styles = true;
        Some(format!(
            "{}([{spread_names}])",
            output.helper_names.merge_styles
        ))
    } else {
        style_attribute.map(|attribute| sources.value(attribute))
    };
    if class_name.is_none() && style.is_none() {
        return None;
    }
    let mut properties = Vec::new();
    if let Some(class_name) = class_name {
        properties.push(format!("className: {class_name}"));
    }
    if let Some(style) = style {
        properties.push(format!("style: {style}"));
    }
    Some(format!("{{\n{},\n}}", properties.join(",\n")))
}

/// Copies the values of attributes the merge replaces, with the edits earlier passes made inside
/// them (like renamed scoped variables in `style`)
struct AttributeSources<'a> {
    source: &'a str,
    edits: &'a mut Vec<Edit>,
}

impl AttributeSources<'_> {
    fn value(&mut self, attribute: &JSXAttribute<'_>) -> String {
        match &attribute.value {
            Some(JSXAttributeValue::StringLiteral(value)) => jsx_string_literal(&value.value),
            Some(JSXAttributeValue::ExpressionContainer(container)) => {
                take_edited_source(self.source, container.expression.span(), self.edits)
            }
            _ => "undefined".to_owned(),
        }
    }
}

fn expression_source(value: &impl GetSpan, source: &str) -> String {
    let span = value.span();
    source[span.start as usize..span.end as usize].to_owned()
}

struct SpreadSource {
    source: String,
    start: u32,
}

fn spread_sources(element: &JSXElement<'_>, source: &str) -> Vec<SpreadSource> {
    element
        .opening_element
        .attributes
        .iter()
        .filter_map(|item| {
            let JSXAttributeItem::SpreadAttribute(spread) = item else {
                return None;
            };
            let span = spread.argument.span();
            Some(SpreadSource {
                source: source[span.start as usize..span.end as usize].to_owned(),
                start: spread.span.start,
            })
        })
        .collect()
}

// The css and cx passes merge their classes into className, which this pass
// also rewrites, so the combination is rejected instead of overlapping edits
fn has_class_merging_prop(element: &JSXElement<'_>, component: Option<&StyledComponent>) -> bool {
    let name = &element.opening_element.name;
    element.opening_element.attributes.iter().any(|item| {
        let JSXAttributeItem::Attribute(attribute) = item else {
            return false;
        };
        let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
            return false;
        };
        match attribute_name.name.as_str() {
            // Custom components get the css class as their own prop instead
            "css" => {
                matches!(
                    &attribute.value,
                    Some(JSXAttributeValue::ExpressionContainer(container))
                        if matches!(container.expression, JSXExpression::TemplateLiteral(_))
                ) && (component.is_some() || !is_component_name(name))
            }
            "cx" => !component.map_or_else(
                || is_foreign_cx_attribute(name, attribute),
                |component| is_foreign_styled_cx_attribute(component, attribute),
            ),
            _ => false,
        }
    })
}
