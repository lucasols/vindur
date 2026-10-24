use oxc_ast::ast::{
    JSXAttribute, JSXAttributeName, JSXAttributeValue, JSXElement, JSXElementName, JSXExpression,
    ObjectPropertyKind, Program,
};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::Scoping;
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use crate::{CompilerDiagnostic, edit::Edit, facts::StaticValue};

use super::{
    css::{clean_css, generate_class_rules},
    css_syntax::{BlockKind, css_error_diagnostic},
    cx_selectors::rewrite_cx_selectors,
    jsx_attributes::{find_attribute, opening_attribute_insertion_offset},
    jsx_class_name::{
        ClassNameMerge, class_name_merge, extend_jsx_string, js_string_literal, jsx_string_value,
        wrap_class_expression,
    },
    jsx_cx::CxElementTransform,
    jsx_cx_attribute::is_component_name,
    runtime_helpers::RuntimeHelperNames,
    scoped::{ScopedVariables, process_scoped_variables},
    static_evaluation::resolved_constant,
    static_value::{TemplateContext, evaluate_template},
    styled::StyledComponent,
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
        if let JSXExpression::Identifier(identifier) = &container.expression {
            let Some(StaticValue::CssClass { .. }) =
                resolved_constant(identifier, self.output.constants, self.output.scoping)
            else {
                self.invalid_value(identifier.span);
                return;
            };
            if let Some(styled) = styled_component(element, self.output.styled_components) {
                self.output.edits.push(Edit {
                    span: attribute.span,
                    replacement: format!(
                        "className={{[\"{}\", {}].filter(Boolean).join(\" \")}}",
                        styled.class_name, identifier.name
                    ),
                });
                return;
            }
            let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
                return;
            };
            self.output.edits.push(Edit {
                span: attribute_name.span,
                replacement: "className".to_owned(),
            });
            return;
        }
        let cx_transform = self.output.cx_elements.get(&element.span.start);
        let (class_name, css_rules) = match &container.expression {
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
                    content = rewrite_cx_selectors(&content, &cx.mappings);
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
                let rules = match process_scoped_variables(
                    &content,
                    BlockKind::Style,
                    template.span,
                    self.output.file_hash,
                    self.output.dev,
                    self.output.id_index,
                    self.output.scoped_variables,
                )
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

        let complete_class = component.map_or(class_name.clone(), |styled| {
            format!("{} {class_name}", styled.class_name)
        });
        let complete_expression =
            cx_transform.map(|cx| format!("\"{complete_class} \" + {}", cx.call));
        let class_name_merge = class_name_merge(element, self.output.source);
        self.output.edits.push(Edit {
            span: attribute.span,
            replacement: match &class_name_merge {
                ClassNameMerge::Insert => complete_expression.as_ref().map_or_else(
                    || format!("className=\"{complete_class}\""),
                    |expression| format!("className={{{expression}}}"),
                ),
                _ => String::new(),
            },
        });
        match class_name_merge {
            ClassNameMerge::Runtime(runtime) => {
                *self.output.needs_merge_helper = true;
                if let Some(span) = runtime.moved_class_name {
                    self.output.edits.push(Edit {
                        span,
                        replacement: String::new(),
                    });
                }
                let insertion_offset =
                    opening_attribute_insertion_offset(element, self.output.source);
                self.output.edits.push(Edit {
                    span: oxc_span::Span::new(insertion_offset, insertion_offset),
                    replacement: format!(
                        " className={{{}([{}], {})}}",
                        self.output.helper_names.merge_class_names,
                        runtime.inputs.join(", "),
                        complete_expression.unwrap_or_else(|| format!("\"{complete_class}\""))
                    ),
                });
            }
            ClassNameMerge::InPlace(class_attribute) => self.merge_class_attribute(
                class_attribute,
                &complete_class,
                cx_transform.map(|cx| cx.call.as_str()),
            ),
            ClassNameMerge::Insert => {}
        }
    }

    fn merge_class_attribute(
        &mut self,
        attribute: &JSXAttribute<'_>,
        class_name: &str,
        cx_call: Option<&str>,
    ) {
        if let Some(JSXAttributeValue::StringLiteral(value)) = &attribute.value {
            self.output.edits.push(match cx_call {
                Some(cx_call) => Edit {
                    span: attribute.span,
                    replacement: format!(
                        "className={{{} + {cx_call}}}",
                        js_string_literal(&format!(
                            "{} {class_name} ",
                            jsx_string_value(&value.value)
                        ))
                    ),
                },
                None => Edit {
                    span: value.span,
                    replacement: extend_jsx_string(
                        value,
                        self.output.source,
                        "",
                        &format!(" {class_name}"),
                    ),
                },
            });
            return;
        }
        let class_expression = cx_call.map_or_else(
            || format!("\"{class_name}\""),
            |cx_call| format!("\"{class_name} \" + {cx_call}"),
        );
        match wrap_class_expression(attribute, &class_expression) {
            Some(edits) => self.output.edits.extend(edits),
            None => self.output.edits.push(Edit {
                span: attribute.span,
                replacement: format!("className={{{class_expression}}}"),
            }),
        }
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

// `css` values vindur doesn't transform are the custom component's own prop
pub(super) fn is_foreign_css_attribute(
    element: &JSXElement<'_>,
    attribute: &JSXAttribute<'_>,
    styled_components: &FxHashMap<String, StyledComponent>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
) -> bool {
    let is_custom = is_component_name(&element.opening_element.name);
    let styled = styled_component(element, styled_components);
    // Styled native elements render a DOM node, so any css value there is vindur's
    if styled.is_some_and(|styled| !styled.element_is_identifier) {
        return false;
    }
    let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
        return styled.map_or(is_custom, |styled| {
            is_foreign_styled_css_attribute(styled, attribute)
        });
    };
    match &container.expression {
        JSXExpression::TemplateLiteral(_) => false,
        JSXExpression::Identifier(identifier) => {
            is_custom
                && (styled.is_none()
                    || !matches!(
                        resolved_constant(identifier, constants, scoping),
                        Some(StaticValue::CssClass { .. })
                    ))
        }
        _ => is_custom,
    }
}

// A string `css` on a custom component is that component's own prop
pub(super) fn is_foreign_styled_css_attribute(
    component: &StyledComponent,
    attribute: &JSXAttribute<'_>,
) -> bool {
    component.element_is_identifier
        && !matches!(
            attribute.value,
            Some(JSXAttributeValue::ExpressionContainer(_))
        )
}
