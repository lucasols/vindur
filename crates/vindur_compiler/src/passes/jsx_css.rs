use oxc_ast::ast::{
    JSXAttribute, JSXAttributeValue, JSXElement, JSXElementName, JSXExpression, ObjectPropertyKind,
    Program,
};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::Scoping;
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use crate::{CompilerDiagnostic, edit::Edit, facts::StaticValue};

use super::{
    css::{clean_css, generate_class_rules},
    css_syntax::{BlockKind, css_error_diagnostic},
    cx_modifier_selectors::{ModifierCss, rewrite_modifiers},
    jsx_attributes::{
        find_attribute, find_attributes, find_last_attribute, opening_attribute_insertion_offset,
    },
    jsx_class_name::{
        ClassNameMerge, ClassNameSources, class_name_merge, emit_class_concat,
        merge_class_name_inputs,
    },
    jsx_cx::CxElementTransform,
    jsx_cx_attribute::is_component_name,
    runtime_helpers::RuntimeHelperNames,
    scoped::{ScopedVariables, process_scoped_variables},
    static_evaluation::resolved_constant,
    static_value::{TemplateContext, evaluate_template},
    styled::StyledComponent,
    styled_jsx_helpers::{
        ClassNameTarget, class_concat, decode_jsx_entities, emit_class_name,
        has_dynamic_color_attribute, has_spread_attribute, inlined_component_classes,
        js_string_literal, unsupported_spread_message, validate_styled_spreads, wrap_jsx_string,
    },
};

pub(crate) struct JsxCssTransform<'a> {
    pub constants: &'a FxHashMap<String, StaticValue>,
    pub scoping: &'a Scoping,
    pub styled_components: &'a FxHashMap<String, StyledComponent>,
    pub file_hash: &'a str,
    pub file_path: &'a str,
    pub source: &'a str,
    pub dev: bool,
    pub id_index: &'a mut u32,
    pub id_starts: &'a FxHashMap<u32, u32>,
    pub edits: &'a mut Vec<Edit>,
    pub css_rules: &'a mut Vec<String>,
    pub needs_merge_helper: &'a mut bool,
    pub helper_names: &'a RuntimeHelperNames,
    pub cx_elements: &'a FxHashMap<u32, CxElementTransform>,
    pub class_expressions: &'a mut FxHashMap<u32, String>,
    pub scoped_variables: &'a mut ScopedVariables,
}

pub(crate) fn transform_jsx_css_props(
    program: &Program<'_>,
    output: JsxCssTransform<'_>,
) -> Result<(), CompilerDiagnostic> {
    let minimum_final_index = *output.id_index;
    let mut visitor = JsxCssVisitor {
        output,
        diagnostic: None,
        pass: JsxCssPass::CssProps,
    };
    visitor.visit_program(program);
    // Style props can set variables of css props in any element, so they are renamed after every
    // css prop is processed
    visitor.pass = JsxCssPass::StyleProps;
    visitor.visit_program(program);
    *visitor.output.id_index = (*visitor.output.id_index).max(minimum_final_index);
    match visitor.diagnostic {
        Some(diagnostic) => Err(diagnostic),
        None => Ok(()),
    }
}

struct JsxCssVisitor<'a> {
    output: JsxCssTransform<'a>,
    diagnostic: Option<CompilerDiagnostic>,
    pass: JsxCssPass,
}

#[derive(Clone, Copy)]
enum JsxCssPass {
    CssProps,
    StyleProps,
}

impl<'a> Visit<'a> for JsxCssVisitor<'_> {
    fn visit_jsx_element(&mut self, element: &JSXElement<'a>) {
        if self.diagnostic.is_some() {
            return;
        }
        match self.pass {
            JsxCssPass::CssProps => {
                // Only one css prop is compiled, a duplicate would be left as is
                if let Some(duplicate) = find_attributes(element, "css").nth(1) {
                    self.diagnostic = Some(CompilerDiagnostic::error(
                        self.output.file_path,
                        self.output.source,
                        duplicate.span,
                        "Duplicate css prop, an element can only have one css prop".to_owned(),
                    ));
                    return;
                }
                if let Some(css_attribute) = find_attribute(element, "css") {
                    self.process_css_attribute(element, css_attribute);
                }
            }
            JsxCssPass::StyleProps => self.process_style_attribute(element),
        }
        if self.diagnostic.is_none() {
            walk::walk_jsx_element(self, element);
        }
    }
}

impl JsxCssVisitor<'_> {
    fn process_style_attribute(&mut self, element: &JSXElement<'_>) {
        let Some(attribute) = find_attribute(element, "style") else {
            return;
        };
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
            return;
        };
        let JSXExpression::ObjectExpression(object) = &container.expression else {
            return;
        };
        let mut transformed = false;
        for property in &object.properties {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                continue;
            };
            let Some(name) = property.key.static_name() else {
                continue;
            };
            let Some(scoped_name) = name.strip_prefix("---") else {
                continue;
            };
            let Some(generated) = self.output.scoped_variables.generated.get(scoped_name) else {
                continue;
            };
            self.output.edits.push(Edit {
                span: property.key.span(),
                replacement: format!("\"--{generated}\""),
            });
            // Setting the variable in the style prop declares it
            self.output
                .scoped_variables
                .declared
                .entry(scoped_name.to_owned())
                .or_insert(property.key.span());
            transformed = true;
        }
        if transformed {
            self.output.edits.push(Edit {
                span: oxc_span::Span::new(object.span.start + 1, object.span.start + 1),
                replacement: "\n".to_owned(),
            });
            self.output.edits.push(Edit {
                span: oxc_span::Span::new(object.span.end - 1, object.span.end - 1),
                replacement: "\n".to_owned(),
            });
        }
    }

    fn process_css_attribute(&mut self, element: &JSXElement<'_>, attribute: &JSXAttribute<'_>) {
        if is_foreign_css_attribute(
            element,
            attribute,
            self.output.styled_components,
            self.output.constants,
            self.output.scoping,
        ) {
            return;
        }
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
            self.invalid_value(attribute.span);
            return;
        };
        let cx_transform = self.output.cx_elements.get(&element.span.start);
        let (class_name, css_rules) = match &container.expression {
            JSXExpression::Identifier(identifier) => {
                let Some(StaticValue::CssClass { name, .. }) =
                    resolved_constant(identifier, self.output.constants, self.output.scoping)
                else {
                    self.invalid_value(identifier.span);
                    return;
                };
                let styled = styled_component(element, self.output.styled_components);
                if styled.is_none()
                    && cx_transform.is_none()
                    && find_last_attribute(element, "className").is_none()
                    && !has_spread_attribute(element)
                    && !has_dynamic_color_attribute(element)
                {
                    // Inlined, so imported references don't need a runtime binding
                    self.output.edits.push(Edit {
                        span: attribute.span,
                        replacement: format!("className=\"{name}\""),
                    });
                    return;
                }
                (name.clone(), Vec::new())
            }
            JSXExpression::TemplateLiteral(template) => {
                if cx_transform.is_none()
                    && let Some(index) = self.output.id_starts.get(&element.span.start)
                {
                    *self.output.id_index = *index;
                }
                let content = match evaluate_template(
                    template,
                    self.output.constants,
                    self.output.scoping,
                    self.output.file_path,
                    self.output.source,
                    &TemplateContext {
                        variable_name: None,
                        tag_type: "css",
                        style_flags: &[],
                    },
                ) {
                    Ok(content) => clean_css(&content),
                    Err(diagnostic) => {
                        self.diagnostic = Some(diagnostic);
                        return;
                    }
                };
                let index = cx_transform.map_or_else(
                    || {
                        let index = *self.output.id_index;
                        *self.output.id_index += 1;
                        index
                    },
                    |cx| cx.css_index,
                );
                let name = if self.output.dev {
                    format!("{}-{index}-css-prop-{index}", self.output.file_hash)
                } else {
                    format!("{}-{index}", self.output.file_hash)
                };
                if let Some(cx) = cx_transform {
                    *self.output.id_index = cx.next_index;
                }
                let rewritten = match cx_transform {
                    Some(cx) => rewrite_modifiers(&content, ModifierCss::Block, &cx.mappings),
                    None => Ok(content),
                };
                // The ids after the class are reserved for the scoped variables of the template
                let rules = match rewritten
                    .and_then(|content| {
                        process_scoped_variables(
                            &content,
                            BlockKind::Style,
                            template.span,
                            self.output.file_hash,
                            self.output.dev,
                            self.output.id_index,
                            self.output.scoped_variables,
                        )
                    })
                    .and_then(|content| generate_class_rules(&name, &content))
                {
                    Ok(rules) => rules,
                    Err(error) => {
                        self.diagnostic = Some(css_error_diagnostic(
                            self.output.file_path,
                            self.output.source,
                            template.span,
                            error,
                        ));
                        return;
                    }
                };
                (name, rules)
            }
            expression => {
                self.invalid_value(expression.span());
                return;
            }
        };

        self.output.css_rules.extend(css_rules);

        let component = styled_component(element, self.output.styled_components);
        if is_component_name(&element.opening_element.name) && component.is_none() {
            let Some(value) = &attribute.value else {
                return;
            };
            self.output.edits.push(Edit {
                span: value.span(),
                replacement: format!("\"{class_name}\""),
            });
            return;
        }

        // Runtime styled components already add their own class name and style flag classes
        let inlined = component
            .filter(|styled| !styled.runtime)
            .map(|styled| inlined_component_classes(element, styled, self.output.source));
        let complete_class = inlined.as_ref().map_or(class_name.clone(), |classes| {
            format!("{} {class_name}", classes.literal)
        });
        let flag_suffix = inlined
            .as_ref()
            .map_or("", |classes| classes.flag_suffix.as_str());
        let cx_call = cx_transform.map(|cx| cx.call.as_str());
        let complete_expression = (cx_call.is_some() || !flag_suffix.is_empty())
            .then(|| class_concat(&complete_class, flag_suffix, cx_call));
        // A className after every spread overrides them, so it's merged in place
        if matches!(class_name_merge(element), ClassNameMerge::Runtime) {
            if let Err(spread) = validate_styled_spreads(element, self.output.source) {
                self.diagnostic = Some(CompilerDiagnostic::error(
                    self.output.file_path,
                    self.output.source,
                    spread.span,
                    unsupported_spread_message(&spread, "an element with vindur css or cx props"),
                ));
                return;
            }
            let (inputs, replaced_attributes) = merge_class_name_inputs(
                element,
                &class_name_sources(&self.output),
                self.output.edits,
            );
            *self.output.needs_merge_helper = true;
            for span in replaced_attributes.into_iter().chain([attribute.span]) {
                self.output.edits.push(Edit {
                    span,
                    replacement: String::new(),
                });
            }
            let insertion_offset = opening_attribute_insertion_offset(element, self.output.source);
            emit_class_name(
                self.output.edits,
                self.output.class_expressions,
                element,
                ClassNameTarget::Insert(insertion_offset),
                format!(
                    "{}([{}], {})",
                    self.output.helper_names.merge_class_names,
                    inputs.join(", "),
                    complete_expression.unwrap_or_else(|| js_string_literal(&complete_class))
                ),
            );
            return;
        }
        if let Some(class_attribute) = find_last_attribute(element, "className") {
            self.output.edits.push(Edit {
                span: attribute.span,
                replacement: String::new(),
            });
            self.merge_class_attribute(
                element,
                class_attribute,
                &complete_class,
                flag_suffix,
                cx_call,
            );
        } else if complete_expression.is_none() && !has_dynamic_color_attribute(element) {
            self.output.edits.push(Edit {
                span: attribute.span,
                replacement: format!("className=\"{complete_class}\""),
            });
        } else {
            emit_class_name(
                self.output.edits,
                self.output.class_expressions,
                element,
                ClassNameTarget::Replace(attribute.span),
                complete_expression.unwrap_or_else(|| js_string_literal(&complete_class)),
            );
        }
    }

    fn merge_class_attribute(
        &mut self,
        element: &JSXElement<'_>,
        attribute: &JSXAttribute<'_>,
        class_name: &str,
        flag_suffix: &str,
        cx_call: Option<&str>,
    ) {
        let Some(JSXAttributeValue::StringLiteral(value)) = &attribute.value else {
            let after = format!(
                " + {}",
                class_concat(&format!(" {class_name}"), flag_suffix, cx_call)
            );
            let sources = class_name_sources(&self.output);
            emit_class_concat(
                self.output.edits,
                self.output.class_expressions,
                element,
                attribute,
                &sources,
                "",
                &after,
            );
            return;
        };
        if cx_call.is_none() && flag_suffix.is_empty() && !has_dynamic_color_attribute(element) {
            self.output.edits.push(Edit {
                span: value.span,
                replacement: wrap_jsx_string(
                    value,
                    self.output.source,
                    "",
                    &format!(" {class_name}"),
                ),
            });
            return;
        }
        let existing = decode_jsx_entities(&value.value);
        let expression = class_concat(&format!("{existing} {class_name}"), flag_suffix, cx_call);
        emit_class_name(
            self.output.edits,
            self.output.class_expressions,
            element,
            ClassNameTarget::Replace(attribute.span),
            expression,
        );
    }

    fn invalid_value(&mut self, span: oxc_span::Span) {
        self.diagnostic = Some(CompilerDiagnostic::error(
            self.output.file_path,
            self.output.source,
            span,
            "Invalid css prop value. Only template literals and references to css function calls are supported"
                .to_owned(),
        ));
    }
}

fn styled_component<'a>(
    element: &JSXElement<'_>,
    components: &'a FxHashMap<String, StyledComponent>,
) -> Option<&'a StyledComponent> {
    match &element.opening_element.name {
        JSXElementName::Identifier(identifier) => components.get(identifier.name.as_str()),
        JSXElementName::IdentifierReference(identifier) => components.get(identifier.name.as_str()),
        _ => None,
    }
}

fn class_name_sources<'a>(output: &JsxCssTransform<'a>) -> ClassNameSources<'a> {
    ClassNameSources {
        source: output.source,
        constants: output.constants,
        scoping: output.scoping,
    }
}

// `css` values vindur doesn't transform are the custom component's own prop. On
// styled custom components only unknown references are forwarded, other values
// are vindur's
pub(super) fn is_foreign_css_attribute(
    element: &JSXElement<'_>,
    attribute: &JSXAttribute<'_>,
    styled_components: &FxHashMap<String, StyledComponent>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
) -> bool {
    if !is_component_name(&element.opening_element.name) {
        return false;
    }
    let Some(styled) = styled_component(element, styled_components) else {
        return !matches!(
            &attribute.value,
            Some(JSXAttributeValue::ExpressionContainer(container))
                if matches!(container.expression, JSXExpression::TemplateLiteral(_))
        );
    };
    let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
        return false;
    };
    styled.element_is_identifier
        && matches!(
            &container.expression,
            JSXExpression::Identifier(identifier)
                if !matches!(
                    resolved_constant(identifier, constants, scoping),
                    Some(StaticValue::CssClass { .. })
                )
        )
}
