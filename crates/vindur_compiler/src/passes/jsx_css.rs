use oxc_ast::ast::{
    JSXAttribute, JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXElement,
    JSXElementName, JSXExpression, ObjectPropertyKind, Program,
};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::Scoping;
use oxc_span::GetSpan;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{CompilerDiagnostic, edit::Edit, facts::StaticValue};

use super::{
    css::clean_css,
    dynamic_color_merge::{ClassPart, DynamicColorClasses},
    id_order::{css_attribute_scoped_variable_count, scoped_variable_names},
    jsx_cx::CxElementTransform,
    scoped::process_scoped_variables,
    static_evaluation::resolved_constant,
    static_value::{TemplateContext, evaluate_template},
    styled::StyledComponent,
    transform_support::jsx_attribute_string,
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
    pub scoped_variables: &'a mut FxHashMap<String, String>,
    pub dynamic_color_classes: &'a mut DynamicColorClasses,
}

pub(crate) fn transform_jsx_css_props(
    program: &Program<'_>,
    output: JsxCssTransform<'_>,
) -> Result<(), CompilerDiagnostic> {
    let minimum_final_index = *output.id_index;
    let mut visitor = JsxCssVisitor {
        output,
        tail_index: minimum_final_index,
        style_objects: Vec::new(),
        diagnostic: None,
    };
    visitor.visit_program(program);
    visitor.process_style_objects();
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
    /// Style objects with `---name` keys, mapped once every css prop is processed
    style_objects: Vec<(oxc_span::Span, Vec<(oxc_span::Span, String)>)>,
    diagnostic: Option<CompilerDiagnostic>,
}

impl<'a> Visit<'a> for JsxCssVisitor<'_> {
    fn visit_jsx_element(&mut self, element: &JSXElement<'a>) {
        if self.diagnostic.is_some() {
            return;
        }
        if let Some(css_attribute) = find_attribute(element, "css") {
            self.process_css_attribute(element, css_attribute);
        }
        self.collect_style_attribute(element);
        if self.diagnostic.is_none() {
            walk::walk_jsx_element(self, element);
        }
    }
}

impl JsxCssVisitor<'_> {
    fn collect_style_attribute(&mut self, element: &JSXElement<'_>) {
        let Some(attribute) = find_attribute(element, "style") else {
            return;
        };
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
            return;
        };
        let JSXExpression::ObjectExpression(object) = &container.expression else {
            return;
        };
        let keys = object
            .properties
            .iter()
            .filter_map(|property| {
                let ObjectPropertyKind::ObjectProperty(property) = property else {
                    return None;
                };
                let name = property.key.static_name()?;
                let scoped_name = name.strip_prefix("---")?;
                Some((property.key.span(), scoped_name.to_owned()))
            })
            .collect::<Vec<_>>();
        if !keys.is_empty() {
            self.style_objects.push((object.span, keys));
        }
    }

    /// Runs after every css prop registered its scoped variables, so a parent's style
    /// prop can set a variable that a child's css prop declares
    fn process_style_objects(&mut self) {
        for (object_span, keys) in std::mem::take(&mut self.style_objects) {
            let mut transformed = false;
            for (key_span, scoped_name) in keys {
                let Some(generated) = self.output.scoped_variables.get(&scoped_name) else {
                    continue;
                };
                self.output.edits.push(Edit {
                    span: key_span,
                    replacement: format!("\"--{generated}\""),
                });
                transformed = true;
            }
            if transformed {
                self.output.edits.push(Edit {
                    span: oxc_span::Span::new(object_span.start + 1, object_span.start + 1),
                    replacement: "\n".to_owned(),
                });
                self.output.edits.push(Edit {
                    span: oxc_span::Span::new(object_span.end - 1, object_span.end - 1),
                    replacement: "\n".to_owned(),
                });
            }
        }
    }

    fn process_css_attribute(&mut self, element: &JSXElement<'_>, attribute: &JSXAttribute<'_>) {
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
            self.invalid_value(attribute.span);
            return;
        };
        if let JSXExpression::Identifier(identifier) = &container.expression {
            let Some(StaticValue::CssClass { .. }) =
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
            // The cx prop of an element with a css prop is emitted here
            let cx_call = self
                .output
                .cx_elements
                .get(&element.span.start)
                .map(|cx| cx.call.clone());
            let mut parts = vec![ClassPart::Expression(identifier.name.to_string())];
            parts.extend(cx_call.clone().map(ClassPart::Expression));
            if self.merge_into_dynamic_color(element, attribute, parts) {
                return;
            }
            let cx_argument = cx_call
                .as_ref()
                .map_or(String::new(), |cx| format!(", {cx}"));
            if let Some(styled) = styled {
                self.output.edits.push(Edit {
                    span: attribute.span,
                    replacement: format!(
                        "className={{[\"{}\", {}{cx_argument}].filter(Boolean).join(\" \")}}",
                        styled.class_name, identifier.name
                    ),
                });
                return;
            }
            if let Some(cx) = cx_call {
                self.output.edits.push(Edit {
                    span: attribute.span,
                    replacement: format!("className={{{} + \" \" + {cx}}}", identifier.name),
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
        let (class_name, css_content) = match &container.expression {
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
                            content =
                                content.replace(&format!("&.{original}"), &format!("&.{hashed}"));
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
                let content = self.process_css_prop_scoped_variables(&content, attribute);
                (name, Some(content))
            }
            expression => {
                if is_custom_component(&element.opening_element.name) {
                    return;
                }
                self.invalid_value(expression.span());
                return;
            }
        };

        if let Some(content) = css_content
            && !content.is_empty()
        {
            self.output
                .css_rules
                .push(format!(".{class_name} {{\n  {content}\n}}"));
        }

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

        let mut dynamic_color_parts = vec![ClassPart::Literal(class_name.clone())];
        dynamic_color_parts.extend(cx_transform.map(|cx| ClassPart::Expression(cx.call.clone())));
        if self.merge_into_dynamic_color(element, attribute, dynamic_color_parts) {
            return;
        }

        let complete_class = component.map_or(class_name.clone(), |styled| {
            format!("{} {class_name}", styled.class_name)
        });
        let complete_expression =
            cx_transform.map(|cx| format!("\"{complete_class} \" + {}", cx.call));
        let spreads = spread_sources(element, self.output.source);
        if !spreads.is_empty() {
            *self.output.needs_merge_helper = true;
            self.output.edits.push(Edit {
                span: attribute.span,
                replacement: String::new(),
            });
            let insertion_offset = opening_attribute_insertion_offset(element, self.output.source);
            self.output.edits.push(Edit {
                span: oxc_span::Span::new(insertion_offset, insertion_offset),
                replacement: format!(
                    " className={{mergeClassNames([{}], {})}}",
                    spreads.join(", "),
                    complete_expression
                        .as_deref()
                        .unwrap_or(&format!("\"{complete_class}\""))
                ),
            });
            return;
        }
        if let Some(class_attribute) = find_last_attribute(element, "className") {
            self.output.edits.push(Edit {
                span: attribute.span,
                replacement: String::new(),
            });
            self.merge_class_attribute(class_attribute, &complete_class);
        } else {
            self.output.edits.push(Edit {
                span: attribute.span,
                replacement: complete_expression.map_or_else(
                    || format!("className=\"{complete_class}\""),
                    |expression| format!("className={{{expression}}}"),
                ),
            });
        }
    }

    /// The scoped variables of a css prop take the ids reserved after its class, unless
    /// interpolations add more names than its template has. Those take ids after every
    /// reserved one, so they can't reuse the ids of a later declaration
    fn process_css_prop_scoped_variables(
        &mut self,
        content: &str,
        attribute: &JSXAttribute<'_>,
    ) -> String {
        let new_names = scoped_variable_names(content)
            .into_iter()
            .filter(|name| !self.output.scoped_variables.contains_key(*name))
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
            self.output.file_hash,
            self.output.dev,
            index,
            self.output.scoped_variables,
        )
    }

    /// The dynamic color pass merges the classes into its `_sp` call, whose spread would
    /// override a `className` prop
    fn merge_into_dynamic_color(
        &mut self,
        element: &JSXElement<'_>,
        attribute: &JSXAttribute<'_>,
        parts: Vec<ClassPart>,
    ) -> bool {
        if find_attribute(element, "dynamicColor").is_none() {
            return false;
        }
        self.output
            .dynamic_color_classes
            .entry(element.span.start)
            .or_default()
            .extend(parts);
        self.output.edits.push(Edit {
            span: attribute.span,
            replacement: String::new(),
        });
        true
    }

    fn merge_class_attribute(&mut self, attribute: &JSXAttribute<'_>, class_name: &str) {
        if let Some(JSXAttributeValue::StringLiteral(value)) = &attribute.value {
            self.output.edits.push(Edit {
                span: value.span,
                replacement: jsx_attribute_string(&format!("{} {class_name}", value.value)),
            });
            return;
        }
        let value_source = attribute.value.as_ref().map_or("undefined", |value| {
            let span = value.span();
            &self.output.source[span.start as usize..span.end as usize]
        });
        self.output.edits.push(Edit {
            span: attribute.span,
            replacement: format!(
                "className={{[{}, \"{class_name}\"].filter(Boolean).join(\" \")}}",
                value_source.trim_matches(['{', '}'])
            ),
        });
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

fn find_attribute<'a>(element: &'a JSXElement<'a>, name: &str) -> Option<&'a JSXAttribute<'a>> {
    element
        .opening_element
        .attributes
        .iter()
        .find_map(|item| {
            let JSXAttributeItem::Attribute(attribute) = item else {
                return None;
            };
            attribute_name(attribute)
                .is_some_and(|attribute_name| attribute_name == name)
                .then_some(attribute)
        })
        .map(|attribute| &**attribute)
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
            attribute_name(attribute)
                .is_some_and(|attribute_name| attribute_name == name)
                .then_some(attribute)
        })
        .map(|attribute| &**attribute)
}

fn attribute_name<'a>(attribute: &'a JSXAttribute<'a>) -> Option<&'a str> {
    let JSXAttributeName::Identifier(identifier) = &attribute.name else {
        return None;
    };
    Some(identifier.name.as_str())
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

fn spread_sources(element: &JSXElement<'_>, source: &str) -> Vec<String> {
    element
        .opening_element
        .attributes
        .iter()
        .filter_map(|item| {
            let JSXAttributeItem::SpreadAttribute(spread) = item else {
                return None;
            };
            let span = spread.argument.span();
            Some(source[span.start as usize..span.end as usize].to_owned())
        })
        .collect()
}

fn opening_attribute_insertion_offset(element: &JSXElement<'_>, source: &str) -> u32 {
    let end = element.opening_element.span.end.saturating_sub(1);
    if source.as_bytes().get(end.saturating_sub(1) as usize) == Some(&b'/') {
        end.saturating_sub(1)
    } else {
        end
    }
}
