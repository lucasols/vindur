use oxc_ast::ast::{
    Argument, Expression, IdentifierReference, JSXAttribute, JSXAttributeItem, JSXAttributeName,
    JSXAttributeValue, JSXElement, JSXElementName, JSXExpression, Program,
};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::Scoping;
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use crate::{CompilerDiagnostic, edit::Edit, facts::StaticValue};

use super::{
    dynamic_color_merge::{
        ClassPart, ColorMerge, DynamicColorClasses, MergeOutput, SpreadSource, color_merge_object,
    },
    static_evaluation::resolved_constant,
    styled::StyledComponent,
    styled_jsx_helpers::collect_flag_class,
    transform_support::js_string_literal,
};

pub(super) struct DynamicColorTransform<'a> {
    pub constants: &'a FxHashMap<String, StaticValue>,
    pub scoping: &'a Scoping,
    pub edits: &'a mut Vec<Edit>,
    pub file_path: &'a str,
    pub source: &'a str,
    pub styled_components: &'a FxHashMap<String, StyledComponent>,
    pub needs_merge_class_names: &'a mut bool,
    pub needs_merge_styles: &'a mut bool,
    pub generated_classes: &'a DynamicColorClasses,
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
        if let Some(identifier) = self.bare_color_identifier(&container.expression) {
            self.error(
                identifier.span,
                format!(
                    "dynamicColor requires a value, use `{}.set(value)`",
                    identifier.name
                ),
            );
            return;
        }
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
        if colors.is_empty() {
            self.error(
                container.expression.span(),
                "dynamicColor array must contain at least one color.set(...)".to_owned(),
            );
            return;
        }
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
        // className and style are merged into the `_sp` call, a spread after them
        // would override them
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

        let mut generated_classes = component
            .filter(|component| !component.runtime)
            .map_or_else(Vec::new, |component| {
                style_flag_classes(element, component, self.output.source, self.output.edits)
            });
        generated_classes.extend(
            self.output
                .generated_classes
                .get(&element.span.start)
                .into_iter()
                .flatten()
                .map(ClassPart::clone),
        );
        let merge = color_merge_object(
            &ColorMerge {
                // Runtime components add their own class
                base_class: component
                    .filter(|component| !component.runtime)
                    .map(|component| component.class_name.as_str()),
                generated_classes: &generated_classes,
                class_attribute,
                style_attribute,
                spreads: &spreads,
            },
            &mut MergeOutput {
                source: self.output.source,
                edits: self.output.edits,
                needs_merge_class_names: self.output.needs_merge_class_names,
                needs_merge_styles: self.output.needs_merge_styles,
            },
        );
        let call = colors.iter().rev().fold(merge, |inner, color| {
            let suffix = inner.map_or(String::new(), |value| format!(", {value}"));
            Some(format!("{}._sp({}{suffix})", color.name, color.value))
        });
        let Some(call) = call else {
            return;
        };
        // Placed after every attribute and spread, `_sp` already merges their className
        // and style
        self.output.edits.push(Edit {
            span: attribute.span,
            replacement: String::new(),
        });
        let offset = opening_attribute_insertion_offset(element, self.output.source);
        self.output.edits.push(Edit {
            span: oxc_span::Span::new(offset, offset),
            replacement: format!(" {{...{call}}}"),
        });
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
            JSXExpression::CallExpression(call) => self.call_color(call),
            JSXExpression::ArrayExpression(array) => array
                .elements
                .iter()
                .map(|element| match element.as_expression()? {
                    Expression::CallExpression(call) => self.call_color(call),
                    _ => None,
                })
                .collect::<Option<Vec<_>>>()
                .map(|groups| groups.into_iter().flatten().collect()),
            _ => None,
        }
    }

    /// A dynamic color passed without `.set()`, e.g. `dynamicColor={color}`, has no value
    fn bare_color_identifier<'e, 'a>(
        &self,
        expression: &'e JSXExpression<'a>,
    ) -> Option<&'e IdentifierReference<'a>> {
        let is_color = |identifier: &IdentifierReference<'_>| {
            matches!(
                resolved_constant(identifier, self.output.constants, self.output.scoping),
                Some(StaticValue::DynamicColor { .. })
            )
        };
        match expression {
            JSXExpression::Identifier(identifier) => is_color(identifier).then_some(&**identifier),
            JSXExpression::ArrayExpression(array) => {
                array
                    .elements
                    .iter()
                    .find_map(|element| match element.as_expression()? {
                        Expression::Identifier(identifier) if is_color(identifier) => {
                            Some(&**identifier)
                        }
                        _ => None,
                    })
            }
            _ => None,
        }
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
            // A spread would also fill the `_sp` merge argument
            let [argument] = call.arguments.as_slice() else {
                return None;
            };
            if matches!(argument, Argument::SpreadElement(_)) {
                return None;
            }
            let span = argument.span();
            return Some(vec![ColorExpression {
                name: color.name.to_string(),
                value: self.output.source[span.start as usize..span.end as usize].to_owned(),
            }]);
        };
        Some(vec![ColorExpression {
            name: color.name.to_string(),
            value: js_string_literal(&value.value),
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

fn expression_source(value: &impl GetSpan, source: &str) -> String {
    let span = value.span();
    source[span.start as usize..span.end as usize].to_owned()
}

fn find_attribute<'a>(element: &'a JSXElement<'a>, name: &str) -> Option<&'a JSXAttribute<'a>> {
    element.opening_element.attributes.iter().find_map(|item| {
        let JSXAttributeItem::Attribute(attribute) = item else {
            return None;
        };
        let JSXAttributeName::Identifier(identifier) = &attribute.name else {
            return None;
        };
        (identifier.name.as_str() == name).then_some(&**attribute)
    })
}

fn find_last_attribute<'a>(
    element: &'a JSXElement<'a>,
    name: &str,
) -> Option<&'a JSXAttribute<'a>> {
    element
        .opening_element
        .attributes
        .iter()
        .rev()
        .find_map(|item| {
            let JSXAttributeItem::Attribute(attribute) = item else {
                return None;
            };
            let JSXAttributeName::Identifier(identifier) = &attribute.name else {
                return None;
            };
            (identifier.name.as_str() == name).then_some(&**attribute)
        })
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

fn jsx_name<'a>(name: &'a JSXElementName<'a>) -> Option<&'a str> {
    match name {
        JSXElementName::Identifier(identifier) => Some(identifier.name.as_str()),
        JSXElementName::IdentifierReference(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}

fn opening_attribute_insertion_offset(element: &JSXElement<'_>, source: &str) -> u32 {
    let end = element.opening_element.span.end.saturating_sub(1);
    if source.as_bytes().get(end.saturating_sub(1) as usize) == Some(&b'/') {
        end.saturating_sub(1)
    } else {
        end
    }
}

/// Removes the style flag props of a styled component and returns their classes
fn style_flag_classes(
    element: &JSXElement<'_>,
    component: &StyledComponent,
    source: &str,
    edits: &mut Vec<Edit>,
) -> Vec<ClassPart> {
    let mut static_classes = Vec::new();
    let mut dynamic_classes = Vec::new();
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
        edits.push(Edit {
            span: attribute.span,
            replacement: String::new(),
        });
        collect_flag_class(
            attribute,
            flag,
            source,
            &mut static_classes,
            &mut dynamic_classes,
        );
    }
    static_classes
        .into_iter()
        .map(ClassPart::Literal)
        .chain(
            dynamic_classes
                .into_iter()
                .map(|class| ClassPart::Expression(class.cx)),
        )
        .collect()
}
