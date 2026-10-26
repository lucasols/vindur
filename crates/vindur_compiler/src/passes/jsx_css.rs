use oxc_ast::ast::{
    JSXAttribute, JSXAttributeValue, JSXElement, JSXElementName, JSXExpression, ObjectPropertyKind,
    Program,
};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::Scoping;
use oxc_span::GetSpan;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{CompilerDiagnostic, edit::Edit, facts::StaticValue};

use super::{
    css::{clean_css, generate_class_rules},
    css_syntax::{BlockKind, CssError, css_error_diagnostic},
    id_order::{css_attribute_scoped_variable_count, scoped_variable_names},
    jsx_attributes::{find_attribute, find_last_attribute, opening_attribute_insertion_offset},
    jsx_cx::CxElementTransform,
    scoped::{ScopedVariables, process_scoped_variables},
    static_evaluation::resolved_constant,
    static_value::{TemplateContext, evaluate_template},
    styled::StyledComponent,
    styled_jsx_helpers::{
        ClassNameTarget, class_name_concat_source, decode_jsx_entities, emit_class_name,
        has_dynamic_color_attribute, has_spread_attribute, js_string_literal,
        merge_class_name_inputs, replace_modifier_selector, styled_spread_sources,
        unsupported_spread_message, wrap_jsx_string,
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
        tail_index: minimum_final_index,
        diagnostic: None,
        pass: JsxCssPass::CssProps,
    };
    visitor.visit_program(program);
    // Style props can set variables of css props in any element, so they are renamed after every
    // css prop is processed
    visitor.pass = JsxCssPass::StyleProps;
    visitor.visit_program(program);
    *visitor.output.id_index = (*visitor.output.id_index)
        .max(minimum_final_index)
        .max(visitor.tail_index);
    match visitor.diagnostic {
        Some(diagnostic) => Err(diagnostic),
        None => Ok(()),
    }
}

struct JsxCssVisitor<'a> {
    output: JsxCssTransform<'a>,
    /// The next id after every reserved one
    tail_index: u32,
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
                    if is_custom_component(&element.opening_element.name) {
                        return;
                    }
                    self.invalid_value(identifier.span);
                    return;
                };
                let styled = styled_component(element, self.output.styled_components);
                if is_custom_component(&element.opening_element.name) && styled.is_none() {
                    return;
                }
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
                let mut content = match evaluate_template(
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
                if let Some(cx) = cx_transform {
                    for (original, hashed, should_rewrite) in &cx.mappings {
                        if *should_rewrite {
                            content = replace_modifier_selector(&content, original, hashed);
                        }
                    }
                }
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
                let rules = match self
                    .process_css_prop_scoped_variables(&content, attribute, template.span)
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
                if is_custom_component(&element.opening_element.name) {
                    return;
                }
                self.invalid_value(expression.span());
                return;
            }
        };

        self.output.css_rules.extend(css_rules);

        let component = styled_component(element, self.output.styled_components);
        if is_custom_component(&element.opening_element.name) && component.is_none() {
            let Some(value) = &attribute.value else {
                return;
            };
            self.output.edits.push(Edit {
                span: value.span(),
                replacement: format!("\"{class_name}\""),
            });
            return;
        }

        let complete_class = component.map_or(class_name.clone(), |styled| {
            format!("{} {class_name}", styled.class_name)
        });
        let complete_expression =
            cx_transform.map(|cx| format!("\"{complete_class} \" + {}", cx.call));
        if has_spread_attribute(element) {
            if let Err(spread) = styled_spread_sources(element, self.output.source) {
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
                self.output.source,
                self.output.constants,
                self.output.scoping,
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
                    "mergeClassNames([{}], {})",
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
                cx_transform.map(|cx| cx.call.as_str()),
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

    /// The scoped variables of a css prop take the ids reserved after its class, unless
    /// interpolations add more names than its template has. Those take ids after every
    /// reserved one, so they can't reuse the ids of a later declaration
    fn process_css_prop_scoped_variables(
        &mut self,
        content: &str,
        attribute: &JSXAttribute<'_>,
        span: oxc_span::Span,
    ) -> Result<String, CssError> {
        let new_names = scoped_variable_names(content)
            .into_iter()
            .filter(|name| !self.output.scoped_variables.generated.contains_key(*name))
            .collect::<FxHashSet<_>>()
            .len();
        let reserved = css_attribute_scoped_variable_count(attribute);
        let index = if u32::try_from(new_names).unwrap_or(u32::MAX) <= reserved {
            &mut *self.output.id_index
        } else {
            &mut self.tail_index
        };
        process_scoped_variables(
            content,
            BlockKind::Style,
            span,
            self.output.file_hash,
            self.output.dev,
            index,
            self.output.scoped_variables,
        )
    }

    fn merge_class_attribute(
        &mut self,
        element: &JSXElement<'_>,
        attribute: &JSXAttribute<'_>,
        class_name: &str,
        cx_call: Option<&str>,
    ) {
        let expression = if let Some(JSXAttributeValue::StringLiteral(value)) = &attribute.value {
            if cx_call.is_none() && !has_dynamic_color_attribute(element) {
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
            cx_call.map_or_else(
                || js_string_literal(&format!("{existing} {class_name}")),
                |cx_call| {
                    format!(
                        "{} + {cx_call}",
                        js_string_literal(&format!("{existing} {class_name} "))
                    )
                },
            )
        } else {
            let existing = class_name_concat_source(
                attribute,
                self.output.source,
                self.output.constants,
                self.output.scoping,
            );
            cx_call.map_or_else(
                || format!("{existing} + \" {class_name}\""),
                |cx_call| format!("{existing} + \" {class_name} \" + {cx_call}"),
            )
        };
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

fn is_custom_component(name: &JSXElementName<'_>) -> bool {
    let identifier = match name {
        JSXElementName::Identifier(identifier) => identifier.name.as_str(),
        JSXElementName::IdentifierReference(identifier) => identifier.name.as_str(),
        _ => return true,
    };
    identifier.chars().next().is_some_and(char::is_uppercase)
}
