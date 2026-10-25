use oxc_ast::ast::{
    JSXAttribute, JSXAttributeValue, JSXElement, JSXElementName, JSXExpression, ObjectPropertyKind,
    Program, PropertyKind,
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
    cx_selectors::contains_class_selector,
    jsx_attributes::{
        find_attribute, find_last_attribute, jsx_name, opening_attribute_insertion_offset,
    },
    jsx_class_name::{
        ClassNameMerge, ClassNameSources, class_name_merge, emit_class_concat,
        merge_class_name_inputs,
    },
    jsx_css::is_foreign_css_attribute,
    jsx_cx_attribute::{is_foreign_cx_attribute, is_foreign_styled_cx_attribute},
    jsx_cx_css_references::{
        css_references, rewrite_class_rules, rewrite_css_references,
        unsupported_css_reference_modifiers,
    },
    runtime_helpers::RuntimeHelperNames,
    styled::StyledComponent,
    styled_jsx_helpers::{
        ClassNameTarget, decode_jsx_entities, emit_class_name, is_class_rule, js_string_literal,
        unsupported_spread_message, validate_styled_spreads,
    },
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
    pub class_expressions: &'a mut FxHashMap<u32, String>,
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
        let css_references = css_references(element, self.output.constants, self.output.scoping);
        let has_css_context = styled.is_some() || has_vindur_css || !css_references.is_empty();
        // Css reference rules are rewritten in place and can be combined in any way across
        // elements, so all of them share a single file-wide index per modifier name
        let context_key = match (&styled, css_references.is_empty()) {
            (Some(_), _) => format!("styled:{element_name}"),
            (None, false) => "css-ref".to_owned(),
            (None, true) => format!("css:{}", element.span.start),
        };
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
                        // Whitespace would split the dev class name into several classes
                        let readable_name = class_name.replace(char::is_whitespace, "_");
                        format!("{}-{index}-{readable_name}", self.output.file_hash)
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
        if let Some((span, message)) = unsupported_css_reference_modifiers(
            element_name,
            styled.is_some(),
            &css_references,
            &mappings,
        ) {
            self.set_error(span, message);
            return;
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
            rewrite_css_references(self.output.css_rules, &css_references, &mappings);
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
        // A className after every spread overrides them, so it's merged in place
        if matches!(class_name_merge(element), ClassNameMerge::Runtime) {
            if let Err(spread) = validate_styled_spreads(element, self.output.source) {
                self.set_error(
                    spread.span,
                    unsupported_spread_message(&spread, "an element with vindur css or cx props"),
                );
                return;
            }
            let complete = styled.as_ref().map_or(cx_call.clone(), |component| {
                format!("\"{} \" + {cx_call}", component.class_name)
            });
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
            let offset = opening_attribute_insertion_offset(element, self.output.source);
            emit_class_name(
                self.output.edits,
                self.output.class_expressions,
                element,
                ClassNameTarget::Insert(offset),
                format!(
                    "{}([{}], {complete})",
                    self.output.helper_names.merge_class_names,
                    inputs.join(", ")
                ),
            );
            return;
        }
        self.output.edits.push(Edit {
            span: attribute.span,
            replacement: String::new(),
        });
        let component = styled.as_ref();
        let Some(class_attribute) = find_last_attribute(element, "className") else {
            let class_name = component.map_or_else(
                || cx_call.clone(),
                |component| format!("\"{} \" + {cx_call}", component.class_name),
            );
            let offset = opening_attribute_insertion_offset(element, self.output.source);
            emit_class_name(
                self.output.edits,
                self.output.class_expressions,
                element,
                ClassNameTarget::Insert(offset),
                class_name,
            );
            return;
        };
        if let Some(JSXAttributeValue::StringLiteral(value)) = &class_attribute.value {
            let existing = decode_jsx_entities(&value.value);
            let prefix = component.map_or_else(
                || format!("{existing} "),
                |component| format!("{existing} {} ", component.class_name),
            );
            emit_class_name(
                self.output.edits,
                self.output.class_expressions,
                element,
                ClassNameTarget::Replace(class_attribute.span),
                format!("{} + {cx_call}", js_string_literal(&prefix)),
            );
            return;
        }
        let separator = component.map_or_else(
            || " ".to_owned(),
            |component| format!(" {} ", component.class_name),
        );
        let sources = class_name_sources(&self.output);
        emit_class_concat(
            self.output.edits,
            self.output.class_expressions,
            element,
            class_attribute,
            &sources,
            "",
            &format!(" + {} + {cx_call}", js_string_literal(&separator)),
        );
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
            .filter(|rule| is_class_rule(rule, base_class))
            .collect::<Vec<_>>();
        let searched_css = if relevant_css.is_empty() {
            self.output.css_rules.iter().collect()
        } else {
            relevant_css
        };
        mappings
            .iter()
            .filter_map(|(original, hashed, should_rewrite)| {
                // Only selectors the cx rewriting matches count, others would silently not match
                let declared = searched_css.iter().any(|css| {
                    contains_class_selector(css, original) || contains_class_selector(css, hashed)
                });
                (*should_rewrite && !declared).then_some(original.clone())
            })
            .collect()
    }

    fn rewrite_styled_css(
        &mut self,
        styled: &StyledComponent,
        mappings: &[(String, String, bool)],
    ) {
        let Some(base_class) = styled.class_name.split_whitespace().last() else {
            return;
        };
        rewrite_class_rules(self.output.css_rules, &[base_class.to_owned()], mappings);
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

fn class_name_sources<'a>(output: &JsxCxTransform<'a>) -> ClassNameSources<'a> {
    ClassNameSources {
        source: output.source,
        constants: output.constants,
        scoping: output.scoping,
    }
}
