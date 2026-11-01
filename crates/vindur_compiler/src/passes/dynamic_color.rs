use oxc_ast::ast::{
    Argument, Expression, JSXAttribute, JSXAttributeItem, JSXAttributeName, JSXAttributeValue,
    JSXElement, JSXExpression, ObjectPropertyKind, Program,
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
    styled_jsx_helpers::{
        decode_jsx_entities, js_string_literal, style_flag_classes, unsupported_spread_message,
        validate_styled_spreads,
    },
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
        if let Some(span) = non_inline_array_options(&container.expression) {
            self.error(
                span,
                "Write the options of each color.set in a dynamicColor array inline, e.g. `color.set(value, { setColorScheme: { fallback: 'dark' } })`, so the colors can be checked for conflicting options".to_owned(),
            );
            return;
        }
        if let Some(span) = second_color_scheme_setter(&container.expression) {
            self.error(
                span,
                "Only one color in a dynamicColor array can use setColorScheme, the element can only have one color scheme. Remove setColorScheme from the other colors".to_owned(),
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
                "dynamicColor prop must be `color.set(value)` or `color.set(value, options)`, or an array of them, where `color` is a dynamic color".to_owned(),
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
        // Spreads are copied into the className and style merges
        if let Err(spread) = validate_styled_spreads(element, self.output.source) {
            self.error(
                spread.span,
                unsupported_spread_message(&spread, "an element with dynamicColor"),
            );
            return;
        }
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

        // Runtime components add their own class
        let compiled_component = component.filter(|component| !component.runtime);
        let flags = compiled_component.map_or_else(VindurClass::default, |component| {
            remove_style_flags(element, component, self.output.source, self.output.edits)
        });
        let merge = color_merge_object(
            class_expression.map_or_else(
                || ClassNameSource::Attributes {
                    vindur_class: VindurClass {
                        literal: compiled_component
                            .map(|component| component.class_name.as_str())
                            .into_iter()
                            .chain((!flags.literal.is_empty()).then_some(flags.literal.as_str()))
                            .collect::<Vec<_>>()
                            .join(" "),
                        dynamic_suffix: flags.dynamic_suffix.clone(),
                    },
                    element,
                },
                |expression| ClassNameSource::Merged(format!("{expression}{}", flags.suffix())),
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
            let suffix = match (inner, &color.options) {
                (None, None) => String::new(),
                (Some(inner), None) => format!(", {inner}"),
                (inner, Some(options)) => format!(
                    ", {}, {options}",
                    inner.unwrap_or_else(|| "undefined".to_owned())
                ),
            };
            Some(format!("{}._sp({}{suffix})", color.name, color.value))
        });
        // `_sp` only sets className and style, already merged from every spread, so it goes last
        self.output.edits.push(Edit {
            span: attribute.span,
            replacement: String::new(),
        });
        let Some(call) = call else {
            return;
        };
        let offset = opening_attribute_insertion_offset(element, self.output.source);
        self.output.edits.push(Edit {
            span: oxc_span::Span::new(offset, offset),
            replacement: format!(" {{...{call}}}"),
        });
    }

    fn conditional_error_message(&self, expression: &JSXExpression<'_>) -> Option<String> {
        let (condition, consequent, alternate) = match expression {
            JSXExpression::ConditionalExpression(conditional) => (
                &conditional.test,
                &conditional.consequent,
                Some(&conditional.alternate),
            ),
            JSXExpression::LogicalExpression(logical) => (&logical.left, &logical.right, None),
            _ => return None,
        };
        let set = self.set_call_parts(consequent)?;
        let alternate = match alternate {
            None => "null".to_owned(),
            // A `set` of the same color with the same options keeps only its value, other
            // `set` calls can't be merged into one suggestion
            Some(alternate) => match self.set_call_parts(alternate) {
                Some(other) if other.color == set.color && other.options == set.options => {
                    other.value
                }
                Some(_) => return None,
                None => expression_source(alternate, self.output.source),
            },
        };
        let options = set
            .options
            .map_or(String::new(), |options| format!(", {options}"));
        Some(format!(
            "Conditional dynamicColor is not supported. Use condition inside the set function instead: {}.set({} ? {} : {alternate}{options})",
            set.color,
            expression_source(condition, self.output.source),
            set.value
        ))
    }

    /// The sources of a `color.set(value, options?)` call
    fn set_call_parts<'b>(&self, expression: &'b Expression<'_>) -> Option<SetCallParts<'b>> {
        let Expression::CallExpression(call) = expression else {
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
        Some(SetCallParts {
            color: color.name.as_str(),
            value: expression_source(argument, self.output.source),
            options: call
                .arguments
                .get(1)
                .map(|options| expression_source(options, self.output.source)),
        })
    }

    fn color_expressions(
        &mut self,
        expression: &JSXExpression<'_>,
    ) -> Option<Vec<ColorExpression>> {
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

    fn call_color(
        &mut self,
        call: &oxc_ast::ast::CallExpression<'_>,
    ) -> Option<Vec<ColorExpression>> {
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
        // A spread would also fill the `_sp` merge argument
        let (value, options) = match call.arguments.as_slice() {
            [value] => (value, None),
            [value, options] => (value, Some(options)),
            _ => return None,
        };
        if matches!(value, Argument::SpreadElement(_))
            || matches!(options, Some(Argument::SpreadElement(_)))
        {
            return None;
        }
        // The arguments are moved, with the edits other passes made inside them, like an inline
        // `stableId()`
        let value = match value {
            Argument::StringLiteral(value) => js_string_literal(&value.value),
            _ => take_edited_source(self.output.source, value.span(), self.output.edits),
        };
        Some(vec![ColorExpression {
            name: color.name.to_string(),
            value,
            options: options.map(|options| {
                take_edited_source(self.output.source, options.span(), self.output.edits)
            }),
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

/// The options of a `set` in a `dynamicColor` array of more than one color that aren't an
/// object literal without spreads and computed keys, so `second_color_scheme_setter` sees
/// every `setColorScheme`
fn non_inline_array_options(expression: &JSXExpression<'_>) -> Option<oxc_span::Span> {
    let JSXExpression::ArrayExpression(array) = expression else {
        return None;
    };
    if array.elements.len() < 2 {
        return None;
    }
    array.elements.iter().find_map(|element| {
        let Expression::CallExpression(call) = element.as_expression()? else {
            return None;
        };
        match call.arguments.get(1)? {
            // Spread arguments are rejected with the invalid dynamicColor error
            Argument::SpreadElement(_) => None,
            Argument::ObjectExpression(options) => options
                .properties
                .iter()
                .any(|property| match property {
                    ObjectPropertyKind::ObjectProperty(property) => property.computed,
                    ObjectPropertyKind::SpreadProperty(_) => true,
                })
                .then_some(options.span),
            options => Some(options.span()),
        }
    })
}

/// The options of the second `set` in a `dynamicColor` array whose options object literal has
/// a `setColorScheme` key, `non_inline_array_options` rejects other options in arrays
fn second_color_scheme_setter(expression: &JSXExpression<'_>) -> Option<oxc_span::Span> {
    let JSXExpression::ArrayExpression(array) = expression else {
        return None;
    };
    array
        .elements
        .iter()
        .filter_map(|element| {
            let Expression::CallExpression(call) = element.as_expression()? else {
                return None;
            };
            let Some(Argument::ObjectExpression(options)) = call.arguments.get(1) else {
                return None;
            };
            options
                .properties
                .iter()
                .any(|property| {
                    matches!(
                        property,
                        ObjectPropertyKind::ObjectProperty(property)
                            if property.key.static_name().as_deref() == Some("setColorScheme")
                    )
                })
                .then_some(options.span)
        })
        .nth(1)
}

struct SetCallParts<'a> {
    color: &'a str,
    value: String,
    options: Option<String>,
}

struct ColorExpression {
    name: String,
    value: String,
    /// The `set` options, forwarded as the third `_sp` argument
    options: Option<String>,
}

enum ClassNameSource<'a> {
    /// Already merged by the css or cx prop passes, with the style flag classes appended
    Merged(String),
    /// Built from the styled component and style flag classes, className attributes and spreads
    Attributes {
        vindur_class: VindurClass,
        element: &'a JSXElement<'a>,
    },
}

/// Classes vindur adds to an element, `dynamic_suffix` concatenates the classes of style flags
/// with a runtime value
#[derive(Default)]
struct VindurClass {
    literal: String,
    dynamic_suffix: String,
}

impl VindurClass {
    fn expression(&self) -> Option<String> {
        (!self.literal.is_empty() || !self.dynamic_suffix.is_empty()).then(|| {
            format!(
                "{}{}",
                js_string_literal(&self.literal),
                self.dynamic_suffix
            )
        })
    }

    /// Appended to a merged className expression
    fn suffix(&self) -> String {
        if self.literal.is_empty() {
            self.dynamic_suffix.clone()
        } else {
            format!(
                " + {}{}",
                js_string_literal(&format!(" {}", self.literal)),
                self.dynamic_suffix
            )
        }
    }
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
        ClassNameSource::Merged(expression) => Some(expression),
        ClassNameSource::Attributes {
            vindur_class,
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
            // The spread classes are read before the flag values, like JSX reads the props
            Some(format!(
                "{}([{}], {}){}",
                helpers.names.merge_class_names,
                class_inputs.join(", "),
                js_string_literal(&vindur_class.literal),
                vindur_class.dynamic_suffix
            ))
        }
        ClassNameSource::Attributes { vindur_class, .. } => {
            match (vindur_class.expression(), class_attribute) {
                (None, None) => None,
                (Some(vindur), None) => Some(vindur),
                (None, Some(attribute)) => Some(sources.value(attribute)),
                (Some(_), Some(attribute)) => {
                    let VindurClass {
                        literal,
                        dynamic_suffix,
                    } = vindur_class;
                    Some(match &attribute.value {
                        Some(JSXAttributeValue::StringLiteral(value)) => format!(
                            "{}{dynamic_suffix}",
                            js_string_literal(&format!(
                                "{literal} {}",
                                decode_jsx_entities(&value.value)
                            ))
                        ),
                        _ => format!(
                            "{} + {}{dynamic_suffix}",
                            js_string_literal(&format!("{literal} ")),
                            sources.class_name_concat(attribute)
                        ),
                    })
                }
            }
        }
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

/// Removes the style flag props of a styled component and returns their classes
fn remove_style_flags(
    element: &JSXElement<'_>,
    component: &StyledComponent,
    source: &str,
    edits: &mut Vec<Edit>,
) -> VindurClass {
    let flags = style_flag_classes(element, component, source);
    for span in &flags.attribute_spans {
        edits.push(Edit {
            span: *span,
            replacement: String::new(),
        });
    }
    VindurClass {
        literal: flags.static_classes.join(" "),
        dynamic_suffix: flags.dynamic_suffix(),
    }
}
