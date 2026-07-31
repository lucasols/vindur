use oxc_ast::ast::{
    JSXAttribute, JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXElement,
    JSXElementName, JSXExpression, ObjectPropertyKind, Program,
};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::Scoping;
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use crate::{CompilerDiagnostic, edit::Edit, facts::StaticValue};

use super::{static_evaluation::resolved_constant, styled::StyledComponent};

#[derive(Clone, Debug)]
pub(crate) struct CxElementTransform {
    pub call: String,
    pub mappings: Vec<(String, String, bool)>,
    pub css_index: u32,
}

pub(crate) struct JsxCxTransform<'a> {
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
    pub elements: &'a mut FxHashMap<u32, CxElementTransform>,
    pub warnings: &'a mut Vec<CompilerDiagnostic>,
    pub needs_cx_helper: &'a mut bool,
}

pub(crate) fn transform_jsx_cx_props(
    program: &Program<'_>,
    output: JsxCxTransform<'_>,
) -> Result<(), CompilerDiagnostic> {
    let minimum_final_index = *output.id_index;
    let mut visitor = JsxCxVisitor {
        output,
        class_indices: FxHashMap::default(),
        diagnostic: None,
    };
    visitor.visit_program(program);
    *visitor.output.id_index = (*visitor.output.id_index).max(minimum_final_index);
    match visitor.diagnostic {
        Some(diagnostic) => Err(diagnostic),
        None => Ok(()),
    }
}

struct JsxCxVisitor<'a> {
    output: JsxCxTransform<'a>,
    class_indices: FxHashMap<String, u32>,
    diagnostic: Option<CompilerDiagnostic>,
}

impl<'a> Visit<'a> for JsxCxVisitor<'_> {
    fn visit_jsx_element(&mut self, element: &JSXElement<'a>) {
        if self.diagnostic.is_some() {
            return;
        }
        if let Some(attribute) = find_attribute(element, "cx") {
            self.process_cx_attribute(element, attribute);
        }
        if self.diagnostic.is_none() {
            walk::walk_jsx_element(self, element);
        }
    }
}

impl JsxCxVisitor<'_> {
    fn process_cx_attribute(&mut self, element: &JSXElement<'_>, attribute: &JSXAttribute<'_>) {
        if let Some(index) = self.output.id_starts.get(&element.span.start) {
            *self.output.id_index = *index;
        }
        let Some(element_name) = jsx_name(&element.opening_element.name) else {
            return;
        };
        let styled = self.output.styled_components.get(element_name).cloned();
        let native = element_name.chars().next().is_some_and(char::is_lowercase);
        if !native && styled.is_none() {
            self.set_error(
                element.opening_element.span,
                format!(
                    "cx prop is not supported on custom component \"{element_name}\". The cx prop only works on native DOM elements (like div, span, button) and styled components."
                ),
            );
            return;
        }
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
            self.set_error(
                attribute.span,
                "cx prop must be an expression container with an object".to_owned(),
            );
            return;
        };
        let JSXExpression::ObjectExpression(object) = &container.expression else {
            self.set_error(
                container.expression.span(),
                "cx prop only accepts object expressions".to_owned(),
            );
            return;
        };

        let has_css_context = styled.is_some()
            || find_attribute(element, "css").is_some()
            || self.class_name_is_css_reference(element);
        let context_key = styled.as_ref().map_or_else(
            || format!("css:{}", element.span.start),
            |_| format!("styled:{element_name}"),
        );
        let css_index = if find_attribute(element, "css").is_some() {
            let index = *self.output.id_index;
            *self.output.id_index += 1;
            Some(index)
        } else {
            None
        };
        let mut properties = Vec::new();
        let mut mappings = Vec::new();
        for property in &object.properties {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                self.set_error(
                    property.span(),
                    "cx prop object must only contain non-computed properties".to_owned(),
                );
                return;
            };
            if property.computed {
                self.set_error(
                    property.span,
                    "cx prop object must only contain non-computed properties".to_owned(),
                );
                return;
            }
            let Some(class_name) = property.key.static_name().map(|name| name.into_owned()) else {
                self.set_error(
                    property.span,
                    "cx prop object keys must be strings or identifiers".to_owned(),
                );
                return;
            };
            if !has_css_context && !class_name.starts_with('$') {
                self.set_error(
                    attribute.span,
                    "cx prop on plain DOM elements requires classes to use $ prefix (e.g., $className) when not used with css prop or styled components. This ensures you're referencing external CSS classes."
                        .to_owned(),
                );
                return;
            }
            let (output_name, should_rewrite_css) =
                if let Some(unhashed) = class_name.strip_prefix('$') {
                    (unhashed.to_owned(), false)
                } else {
                    let key = format!("{context_key}:{class_name}");
                    let index = *self.class_indices.entry(key).or_insert_with(|| {
                        let index = *self.output.id_index;
                        *self.output.id_index += 1;
                        index
                    });
                    let hashed = if self.output.dev {
                        format!("{}-{index}-{class_name}", self.output.file_hash)
                    } else {
                        format!("{}-{index}", self.output.file_hash)
                    };
                    (hashed, true)
                };
            let value_span = property.value.span();
            let value = &self.output.source[value_span.start as usize..value_span.end as usize];
            properties.push(format!("\"{output_name}\": {value}"));
            mappings.push((class_name, output_name, should_rewrite_css));
        }

        if let Some(styled) = &styled {
            let conflicts = styled
                .style_flags
                .iter()
                .filter(|flag| {
                    mappings.iter().any(|(class_name, _, _)| {
                        !class_name.starts_with('$')
                            && (class_name == &flag.prop_name
                                || class_name
                                    .strip_prefix(&flag.prop_name)
                                    .is_some_and(|suffix| suffix.starts_with('-')))
                    })
                })
                .map(|flag| flag.prop_name.as_str())
                .collect::<Vec<_>>();
            if !conflicts.is_empty() {
                let message = if conflicts.len() == 1 {
                    format!(
                        "Style flag prop '{}' conflicts with cx prop key '{}' on {element_name}. Use different names to avoid conflicts.",
                        conflicts[0], conflicts[0]
                    )
                } else {
                    format!(
                        "Style flag props [{}] conflict with cx prop keys on {element_name}. Use different names to avoid conflicts.",
                        conflicts.join(", ")
                    )
                };
                self.set_error(element.opening_element.span, message);
                return;
            }
        }

        *self.output.needs_cx_helper = true;
        if self.output.dev
            && let Some(styled) = &styled
        {
            let missing = self.missing_styled_classes(styled, &mappings);
            if !missing.is_empty() {
                self.output.warnings.push(CompilerDiagnostic::warning(
                    "",
                    self.output.source,
                    element.opening_element.span,
                    format!(
                        "Warning: Missing CSS classes for cx modifiers in {element_name}: {}",
                        missing.join(", ")
                    ),
                ));
            }
        }

        if let Some(styled) = &styled {
            self.rewrite_styled_css(styled, &mappings);
        } else {
            self.rewrite_css_reference(element, &mappings);
        }
        let object_source = format!("{{\n{},\n}}", properties.join(",\n"));
        let cx_call = format!("cx({object_source})");
        if let Some(css_index) = css_index {
            self.output.elements.insert(
                element.span.start,
                CxElementTransform {
                    call: cx_call,
                    mappings,
                    css_index,
                },
            );
            self.output.edits.push(Edit {
                span: attribute.span,
                replacement: String::new(),
            });
            return;
        }
        let spreads = spread_sources(element, self.output.source);
        if !spreads.is_empty() {
            let complete = styled.as_ref().map_or(cx_call.clone(), |component| {
                format!("\"{} \" + {cx_call}", component.class_name)
            });
            self.output.edits.push(Edit {
                span: attribute.span,
                replacement: String::new(),
            });
            let offset = opening_attribute_insertion_offset(element, self.output.source);
            self.output.edits.push(Edit {
                span: oxc_span::Span::new(offset, offset),
                replacement: format!(
                    " className={{mergeClassNames([{}], {complete})}}",
                    spreads.join(", ")
                ),
            });
            return;
        }
        if find_last_attribute(element, "className").is_none() {
            let class_name = styled.as_ref().map_or_else(
                || format!("className={{{cx_call}}}"),
                |component| format!("className={{\"{} \" + {cx_call}}}", component.class_name),
            );
            self.output.edits.push(Edit {
                span: attribute.span,
                replacement: String::new(),
            });
            let offset = opening_attribute_insertion_offset(element, self.output.source);
            self.output.edits.push(Edit {
                span: oxc_span::Span::new(offset, offset),
                replacement: format!(" {class_name}"),
            });
            return;
        }
        let replacement = match (styled.as_ref(), find_last_attribute(element, "className")) {
            (Some(_), None) | (None, None) => String::new(),
            (component, Some(class_attribute)) => {
                let existing = class_name_value_source(class_attribute, self.output.source);
                let prefix = component.map_or_else(
                    || match &class_attribute.value {
                        Some(JSXAttributeValue::StringLiteral(_)) => {
                            format!("\"{} \"", existing.trim_matches('"'))
                        }
                        _ => format!("{existing} + \" \""),
                    },
                    |value| match &class_attribute.value {
                        Some(JSXAttributeValue::StringLiteral(_)) => {
                            format!("\"{} {} \"", existing.trim_matches('"'), value.class_name)
                        }
                        _ => format!("{existing} + \" {} \"", value.class_name),
                    },
                );
                self.output.edits.push(Edit {
                    span: class_attribute.span,
                    replacement: format!("className={{{prefix} + {cx_call}}}"),
                });
                String::new()
            }
        };
        self.output.edits.push(Edit {
            span: attribute.span,
            replacement,
        });
    }

    fn missing_styled_classes(
        &self,
        styled: &StyledComponent,
        mappings: &[(String, String, bool)],
    ) -> Vec<String> {
        let Some(base_class) = styled.class_name.split_whitespace().last() else {
            return Vec::new();
        };
        let relevant_css = self
            .output
            .css_rules
            .iter()
            .find(|rule| rule.starts_with(&format!(".{base_class} {{")))
            .map(String::as_str);
        mappings
            .iter()
            .filter_map(|(original, hashed, should_rewrite)| {
                let declared = relevant_css.map_or_else(
                    || {
                        self.output.css_rules.iter().any(|rule| {
                            rule.contains(&format!(".{original}"))
                                || rule.contains(&format!(".{hashed}"))
                        })
                    },
                    |css| {
                        css.contains(&format!(".{original}")) || css.contains(&format!(".{hashed}"))
                    },
                );
                (*should_rewrite && !declared).then_some(original.clone())
            })
            .collect()
    }

    fn class_name_is_css_reference(&self, element: &JSXElement<'_>) -> bool {
        let Some(attribute) = find_last_attribute(element, "className") else {
            return false;
        };
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
            return false;
        };
        let JSXExpression::Identifier(identifier) = &container.expression else {
            return false;
        };
        matches!(
            resolved_constant(identifier, self.output.constants, self.output.scoping),
            Some(StaticValue::CssClass { .. })
        )
    }

    fn rewrite_styled_css(
        &mut self,
        styled: &StyledComponent,
        mappings: &[(String, String, bool)],
    ) {
        let Some(base_class) = styled.class_name.split_whitespace().last() else {
            return;
        };
        for rule in self
            .output
            .css_rules
            .iter_mut()
            .filter(|rule| rule.starts_with(&format!(".{base_class} {{")))
        {
            for (original, hashed, should_rewrite) in mappings {
                if *should_rewrite {
                    *rule = rule.replace(&format!("&.{original}"), &format!("&.{hashed}"));
                }
            }
        }
    }

    fn rewrite_css_reference(
        &mut self,
        element: &JSXElement<'_>,
        mappings: &[(String, String, bool)],
    ) {
        let Some(attribute) = find_last_attribute(element, "className") else {
            return;
        };
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
            return;
        };
        let JSXExpression::Identifier(identifier) = &container.expression else {
            return;
        };
        let Some(StaticValue::CssClass { name, .. }) =
            resolved_constant(identifier, self.output.constants, self.output.scoping)
        else {
            return;
        };
        for rule in self
            .output
            .css_rules
            .iter_mut()
            .filter(|rule| rule.starts_with(&format!(".{name} {{")))
        {
            for (original, hashed, should_rewrite) in mappings {
                if *should_rewrite {
                    *rule = rule.replace(&format!("&.{original}"), &format!("&.{hashed}"));
                }
            }
        }
    }

    fn set_error(&mut self, span: oxc_span::Span, message: String) {
        self.diagnostic = Some(CompilerDiagnostic::error(
            self.output.file_path,
            self.output.source,
            span,
            message,
        ));
    }
}

fn find_attribute<'a>(element: &'a JSXElement<'a>, name: &str) -> Option<&'a JSXAttribute<'a>> {
    element.opening_element.attributes.iter().find_map(|item| {
        let JSXAttributeItem::Attribute(attribute) = item else {
            return None;
        };
        (attribute_name(attribute) == Some(name)).then_some(&**attribute)
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
            (attribute_name(attribute) == Some(name)).then_some(&**attribute)
        })
}

fn attribute_name<'a>(attribute: &'a JSXAttribute<'a>) -> Option<&'a str> {
    let JSXAttributeName::Identifier(identifier) = &attribute.name else {
        return None;
    };
    Some(identifier.name.as_str())
}

fn jsx_name<'a>(name: &'a JSXElementName<'a>) -> Option<&'a str> {
    match name {
        JSXElementName::Identifier(identifier) => Some(identifier.name.as_str()),
        JSXElementName::IdentifierReference(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}

fn class_name_value_source(attribute: &JSXAttribute<'_>, source: &str) -> String {
    match &attribute.value {
        Some(JSXAttributeValue::StringLiteral(value)) => format!("\"{}\"", value.value),
        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            let span = container.expression.span();
            source[span.start as usize..span.end as usize].to_owned()
        }
        _ => "undefined".to_owned(),
    }
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
