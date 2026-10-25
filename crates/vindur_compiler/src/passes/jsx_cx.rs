use oxc_ast::ast::{
    IdentifierReference, JSXAttribute, JSXAttributeValue, JSXElement, JSXElementName,
    JSXExpression, ObjectPropertyKind, Program, PropertyKind,
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
    cx_selectors::{contains_class_selector, rewrite_cx_selectors},
    jsx_attributes::{
        find_attribute, find_last_attribute, jsx_name, opening_attribute_insertion_offset,
    },
    jsx_class_name::{
        ClassNameMerge, class_name_merge, js_string_literal, jsx_string_value,
        wrap_class_expression,
    },
    jsx_css::is_foreign_css_attribute,
    jsx_cx_attribute::{is_foreign_cx_attribute, is_foreign_styled_cx_attribute},
    runtime_helpers::RuntimeHelperNames,
    static_evaluation::resolved_constant,
    styled::StyledComponent,
};

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
    pub needs_merge_helper: &'a mut bool,
    pub helper_names: &'a RuntimeHelperNames,
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
        let name = &element.opening_element.name;
        let styled = jsx_name(name)
            .and_then(|name| self.output.styled_components.get(name))
            .cloned();
        let is_foreign = styled.as_ref().map_or_else(
            || is_foreign_cx_attribute(name, attribute),
            |component| is_foreign_styled_cx_attribute(component, attribute),
        );
        if is_foreign {
            return;
        }
        let source = self.output.source;
        let element_name = &source[name.span().start as usize..name.span().end as usize];
        let native = matches!(name, JSXElementName::Identifier(_));
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

        // A foreign `css` is left as is by the css pass, so cx takes the className path
        let has_vindur_css = find_attribute(element, "css").is_some_and(|css| {
            !is_foreign_css_attribute(
                element,
                css,
                self.output.styled_components,
                self.output.constants,
                self.output.scoping,
            )
        });
        let has_css_context =
            styled.is_some() || has_vindur_css || self.class_name_is_css_reference(element);
        let context_key = styled.as_ref().map_or_else(
            || format!("css:{}", element.span.start),
            |_| format!("styled:{element_name}"),
        );
        let css_index = if has_vindur_css {
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
            if property.kind != PropertyKind::Init || property.method {
                self.set_error(
                    property.span,
                    "cx prop object must only contain `key: value` properties, not methods, getters or setters"
                        .to_owned(),
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
            // The value is copied into the generated call, with the edits of other passes inside
            // it, like a `stableId()` call
            let value = take_edited_source(self.output.source, value_span, self.output.edits);
            // A `"__proto__"` key would set the prototype instead of adding the class
            let key = if output_name == "__proto__" {
                format!("[{}]", js_string_literal(&output_name))
            } else {
                js_string_literal(&output_name)
            };
            properties.push(format!("{key}: {value}"));
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
        let object_source = if properties.is_empty() {
            "{}".to_owned()
        } else {
            format!("{{\n{},\n}}", properties.join(",\n"))
        };
        let cx_call = format!("{}({object_source})", self.output.helper_names.cx);
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
        let complete = styled.as_ref().map_or_else(
            || cx_call.clone(),
            |component| format!("\"{} \" + {cx_call}", component.class_name),
        );
        self.output.edits.push(Edit {
            span: attribute.span,
            replacement: String::new(),
        });
        match class_name_merge(element, self.output.source) {
            ClassNameMerge::Runtime(runtime) => {
                *self.output.needs_merge_helper = true;
                if let Some(span) = runtime.moved_class_name {
                    self.output.edits.push(Edit {
                        span,
                        replacement: String::new(),
                    });
                }
                let offset = opening_attribute_insertion_offset(element, self.output.source);
                self.output.edits.push(Edit {
                    span: oxc_span::Span::new(offset, offset),
                    replacement: format!(
                        " className={{{}([{}], {complete})}}",
                        self.output.helper_names.merge_class_names,
                        runtime.inputs.join(", ")
                    ),
                });
            }
            ClassNameMerge::InPlace(class_attribute) => {
                let styled_class = styled.as_ref().map_or(String::new(), |component| {
                    format!("{} ", component.class_name)
                });
                if let Some(JSXAttributeValue::StringLiteral(value)) = &class_attribute.value {
                    self.output.edits.push(Edit {
                        span: class_attribute.span,
                        replacement: format!(
                            "className={{{} + {cx_call}}}",
                            js_string_literal(&format!(
                                "{} {styled_class}",
                                jsx_string_value(&value.value)
                            ))
                        ),
                    });
                } else if let Some(reference) = self.css_reference_class_name(class_attribute) {
                    // A css reference is never empty, so it's concatenated directly
                    self.output.edits.push(Edit {
                        span: oxc_span::Span::new(reference.span.end, class_attribute.span.end),
                        replacement: format!(
                            " + {} + {cx_call}}}",
                            js_string_literal(&format!(" {styled_class}"))
                        ),
                    });
                } else if let Some(edits) = wrap_class_expression(class_attribute, &complete) {
                    self.output.edits.extend(edits);
                } else {
                    self.output.edits.push(Edit {
                        span: class_attribute.span,
                        replacement: format!("className={{{complete}}}"),
                    });
                }
            }
            ClassNameMerge::Insert => {
                let offset = opening_attribute_insertion_offset(element, self.output.source);
                self.output.edits.push(Edit {
                    span: oxc_span::Span::new(offset, offset),
                    replacement: format!(" className={{{complete}}}"),
                });
            }
        }
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
                let declares = |css: &str| {
                    contains_class_selector(css, original) || contains_class_selector(css, hashed)
                };
                let declared = relevant_css.map_or_else(
                    || self.output.css_rules.iter().any(|rule| declares(rule)),
                    declares,
                );
                (*should_rewrite && !declared).then_some(original.clone())
            })
            .collect()
    }

    fn class_name_is_css_reference(&self, element: &JSXElement<'_>) -> bool {
        find_last_attribute(element, "className")
            .is_some_and(|attribute| self.css_reference_class_name(attribute).is_some())
    }

    fn css_reference_class_name<'a>(
        &self,
        attribute: &'a JSXAttribute<'a>,
    ) -> Option<&'a IdentifierReference<'a>> {
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
            return None;
        };
        let JSXExpression::Identifier(identifier) = &container.expression else {
            return None;
        };
        matches!(
            resolved_constant(identifier, self.output.constants, self.output.scoping),
            Some(StaticValue::CssClass { .. })
        )
        .then_some(&**identifier)
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
            *rule = rewrite_cx_selectors(rule, mappings);
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
            *rule = rewrite_cx_selectors(rule, mappings);
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
