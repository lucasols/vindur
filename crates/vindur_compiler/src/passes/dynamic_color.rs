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
    jsx_class_name::{ClassNameSources, edited_class_name_concat_source, merge_class_name_inputs},
    runtime_helpers::RuntimeHelperNames,
    static_evaluation::resolved_constant,
    styled::StyledComponent,
    styled_jsx_helpers::{decode_jsx_entities, js_string_literal},
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
    pub helper_names: &'a RuntimeHelperNames,
    /// Merged className expressions emitted by the css and cx prop passes, by element start
    pub class_expressions: &'a FxHashMap<u32, String>,
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
        let element_name = jsx_name(&element.opening_element.name);
        let component = element_name.and_then(|name| self.output.styled_components.get(name));
        let class_expression = self.output.class_expressions.get(&element.span.start);
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
        // `_sp` returns the final className and style, so they are always merged into it
        for item in &element.opening_element.attributes {
            let JSXAttributeItem::Attribute(other) = item else {
                continue;
            };
            let JSXAttributeName::Identifier(name) = &other.name else {
                continue;
            };
            // The css and cx prop passes already removed the className attributes
            if name.name.as_str() == "style"
                || (name.name.as_str() == "className" && class_expression.is_none())
            {
                self.output.edits.push(Edit {
                    span: other.span,
                    replacement: String::new(),
                });
            }
        }

        let base_class = component.map(|component| component.class_name.as_str());
        let merge = color_merge_object(
            class_expression.map_or(
                ClassNameSource::Attributes {
                    base_class,
                    element,
                },
                |expression| ClassNameSource::Merged(expression),
            ),
            class_attribute,
            style_attribute,
            &spreads,
            &mut AttributeSources {
                source: self.output.source,
                constants: self.output.constants,
                scoping: self.output.scoping,
                edits: self.output.edits,
            },
            &mut MergeHelpers {
                names: self.output.helper_names,
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
        // `_sp` only sets className and style, already merged from every spread, so it goes last
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

enum ClassNameSource<'a> {
    /// Already merged by the css or cx prop passes
    Merged(&'a str),
    /// Built from the styled component class, className attributes and spreads
    Attributes {
        base_class: Option<&'a str>,
        element: &'a JSXElement<'a>,
    },
}

fn color_merge_object(
    class_source: ClassNameSource<'_>,
    class_attribute: Option<&JSXAttribute<'_>>,
    style_attribute: Option<&JSXAttribute<'_>>,
    spreads: &[SpreadSource],
    sources: &mut AttributeSources<'_>,
    helpers: &mut MergeHelpers<'_>,
) -> Option<String> {
    let last_spread_start = spreads.last().map_or(0, |spread| spread.start);
    let class_after_spreads = class_attribute
        .is_some_and(|attribute| spreads.is_empty() || attribute.span.start > last_spread_start);
    let style_after_spreads = style_attribute
        .is_some_and(|attribute| spreads.is_empty() || attribute.span.start > last_spread_start);
    let class_name = match class_source {
        ClassNameSource::Merged(expression) => Some(expression.to_owned()),
        ClassNameSource::Attributes {
            base_class,
            element,
        } if !spreads.is_empty() && !class_after_spreads => {
            *helpers.needs_merge_class_names = true;
            let (class_inputs, _) = merge_class_name_inputs(
                element,
                &ClassNameSources {
                    source: sources.source,
                    constants: sources.constants,
                    scoping: sources.scoping,
                },
                sources.edits,
            );
            Some(format!(
                "{}([{}], {})",
                helpers.names.merge_class_names,
                class_inputs.join(", "),
                base_class.map_or("\"\"".to_owned(), |base| format!("\"{base}\""))
            ))
        }
        ClassNameSource::Attributes { base_class, .. } => match (base_class, class_attribute) {
            (None, None) => None,
            (Some(base), None) => Some(format!("\"{base}\"")),
            (None, Some(attribute)) => Some(sources.value(attribute)),
            (Some(base), Some(attribute)) => match &attribute.value {
                Some(JSXAttributeValue::StringLiteral(value)) => Some(js_string_literal(&format!(
                    "{base} {}",
                    decode_jsx_entities(&value.value)
                ))),
                _ => Some(format!(
                    "\"{base} \" + {}",
                    sources.class_name_concat(attribute)
                )),
            },
        },
    };
    let style = if !spreads.is_empty() && !style_after_spreads {
        *helpers.needs_merge_styles = true;
        // Only spreads after the explicit style can override it
        let style_start = style_attribute.map_or(0, |attribute| attribute.span.start);
        let overriding_spreads = spreads
            .iter()
            .filter(|spread| spread.start > style_start)
            .map(|spread| spread.source.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        let merge_styles = &helpers.names.merge_styles;
        Some(style_attribute.map_or_else(
            || format!("{merge_styles}([{overriding_spreads}])"),
            |attribute| {
                format!(
                    "{merge_styles}([{overriding_spreads}], {})",
                    sources.value(attribute)
                )
            },
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

/// The runtime merge helpers the merge object calls
struct MergeHelpers<'a> {
    names: &'a RuntimeHelperNames,
    needs_merge_class_names: &'a mut bool,
    needs_merge_styles: &'a mut bool,
}

/// Copies the values of attributes the merge replaces, with the edits earlier passes made inside
/// them (like renamed scoped variables in `style`)
struct AttributeSources<'a> {
    source: &'a str,
    constants: &'a FxHashMap<String, StaticValue>,
    scoping: &'a Scoping,
    edits: &'a mut Vec<Edit>,
}

impl AttributeSources<'_> {
    fn value(&mut self, attribute: &JSXAttribute<'_>) -> String {
        match &attribute.value {
            Some(JSXAttributeValue::StringLiteral(value)) => {
                js_string_literal(&decode_jsx_entities(&value.value))
            }
            Some(JSXAttributeValue::ExpressionContainer(container)) => {
                take_edited_source(self.source, container.expression.span(), self.edits)
            }
            _ => "undefined".to_owned(),
        }
    }

    fn class_name_concat(&mut self, attribute: &JSXAttribute<'_>) -> String {
        edited_class_name_concat_source(
            attribute,
            &ClassNameSources {
                source: self.source,
                constants: self.constants,
                scoping: self.scoping,
            },
            self.edits,
        )
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
