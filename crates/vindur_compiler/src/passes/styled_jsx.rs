use oxc_ast::ast::{JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXElement};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::Scoping;
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use crate::{CompilerDiagnostic, edit::Edit};

use super::{
    jsx_attributes::{jsx_name, opening_attribute_insertion_offset},
    jsx_class_name::{
        ClassNameMerge, ClassNameSources, class_name_concat_source, class_name_merge,
        merge_class_name_inputs, wrap_class_concat, wrap_class_expression,
    },
    jsx_cx_attribute::is_foreign_styled_cx_attribute,
    runtime_helpers::RuntimeHelperNames,
    styled::StyledComponent,
};

pub(crate) struct StyledJsxTransform<'a> {
    pub components: &'a FxHashMap<String, StyledComponent>,
    pub constants: &'a FxHashMap<String, crate::facts::StaticValue>,
    pub scoping: &'a Scoping,
    pub edits: &'a mut Vec<Edit>,
    pub file_path: &'a str,
    pub source: &'a str,
    pub needs_merge_helper: &'a mut bool,
    pub helper_names: &'a RuntimeHelperNames,
}

pub(crate) fn rewrite_styled_jsx(
    program: &oxc_ast::ast::Program<'_>,
    output: StyledJsxTransform<'_>,
) -> Result<(), CompilerDiagnostic> {
    let mut visitor = StyledJsxVisitor {
        components: output.components,
        constants: output.constants,
        scoping: output.scoping,
        edits: output.edits,
        file_path: output.file_path,
        source: output.source,
        needs_merge_helper: output.needs_merge_helper,
        helper_names: output.helper_names,
        diagnostic: None,
    };
    visitor.visit_program(program);
    visitor.diagnostic.map_or(Ok(()), Err)
}

struct StyledJsxVisitor<'c, 'e, 's> {
    components: &'c FxHashMap<String, StyledComponent>,
    constants: &'c FxHashMap<String, crate::facts::StaticValue>,
    scoping: &'c Scoping,
    edits: &'e mut Vec<Edit>,
    file_path: &'s str,
    source: &'s str,
    needs_merge_helper: &'e mut bool,
    helper_names: &'c RuntimeHelperNames,
    diagnostic: Option<CompilerDiagnostic>,
}

impl<'a> Visit<'a> for StyledJsxVisitor<'_, '_, '_> {
    fn visit_jsx_element(&mut self, element: &JSXElement<'a>) {
        if self.diagnostic.is_some() {
            return;
        }
        let Some(component_name) = jsx_name(&element.opening_element.name) else {
            walk::walk_jsx_element(self, element);
            return;
        };
        let Some(component) = self.components.get(component_name) else {
            walk::walk_jsx_element(self, element);
            return;
        };
        if component.runtime {
            walk::walk_jsx_element(self, element);
            return;
        }
        if let Some((flag_name, span)) = side_effect_in_string_flag_value(element, component) {
            self.diagnostic = Some(CompilerDiagnostic::error(
                self.file_path,
                self.source,
                span,
                format!(
                    "Style flag `{flag_name}` value can't contain calls, `new`, assignments, `++`, `--`, `delete`, `await` or tagged templates, as it's read twice, assign it to a variable first"
                ),
            ));
            return;
        }
        let has_dynamic_color = element.opening_element.attributes.iter().any(|item| {
            let JSXAttributeItem::Attribute(attribute) = item else {
                return false;
            };
            let JSXAttributeName::Identifier(name) = &attribute.name else {
                return false;
            };
            name.name.as_str() == "dynamicColor"
        });
        if has_dynamic_color {
            walk::walk_jsx_element(self, element);
            return;
        }

        if let Err(spread) = validate_styled_spreads(element, self.source) {
            self.diagnostic = Some(CompilerDiagnostic::error(
                self.file_path,
                self.source,
                spread.span,
                unsupported_spread_message(&spread, "vindur styled component"),
            ));
            return;
        }

        let opening_name_span = element.opening_element.name.span();
        self.edits.push(Edit {
            span: opening_name_span,
            replacement: component.element.clone(),
        });

        let has_compile_time_class_attribute =
            element.opening_element.attributes.iter().any(|item| {
                let JSXAttributeItem::Attribute(attribute) = item else {
                    return false;
                };
                let JSXAttributeName::Identifier(name) = &attribute.name else {
                    return false;
                };
                match name.name.as_str() {
                    "cx" => !is_foreign_styled_cx_attribute(component, attribute),
                    "css" => css_attribute_is_compile_time(attribute, self.constants, self.scoping),
                    _ => false,
                }
            });
        let has_dynamic_css_attribute = element.opening_element.attributes.iter().any(|item| {
            let JSXAttributeItem::Attribute(attribute) = item else {
                return false;
            };
            let JSXAttributeName::Identifier(name) = &attribute.name else {
                return false;
            };
            name.name.as_str() == "css"
                && !css_attribute_is_compile_time(attribute, self.constants, self.scoping)
        });

        if !component.style_flags.is_empty() && !has_compile_time_class_attribute {
            self.rewrite_style_flags(element, component);
        } else if has_compile_time_class_attribute {
            // The JSX prop passes emit the combined styled, style flag and generated class names
            for span in style_flag_classes(element, component, self.source).attribute_spans {
                self.edits.push(Edit {
                    span,
                    replacement: String::new(),
                });
            }
        } else {
            match class_name_merge(element) {
                ClassNameMerge::Runtime => {
                    let merged =
                        self.runtime_class_name(element, &js_string_literal(&component.class_name));
                    self.insert_class_name(element, &merged);
                }
                ClassNameMerge::InPlace(attribute) => {
                    self.merge_class_name_in_place(attribute, component);
                }
                ClassNameMerge::Insert => {
                    let offset = opening_attribute_insertion_offset(element, self.source);
                    self.edits.push(Edit {
                        span: oxc_span::Span::new(offset, offset),
                        replacement: if has_dynamic_css_attribute {
                            format!(" className={{\"{}\"}}", component.class_name)
                        } else {
                            format!(" className=\"{}\"", component.class_name)
                        },
                    });
                }
            }
        }

        if let Some(closing) = &element.closing_element {
            self.edits.push(Edit {
                span: closing.name.span(),
                replacement: component.element.clone(),
            });
        }

        walk::walk_jsx_element(self, element);
    }
}

impl StyledJsxVisitor<'_, '_, '_> {
    // Removes the className attributes merged at runtime and returns the `mergeClassNames` call
    /// `vindur_class` is the JS expression of the vindur classes, merged last
    fn runtime_class_name(&mut self, element: &JSXElement<'_>, vindur_class: &str) -> String {
        *self.needs_merge_helper = true;
        let sources = ClassNameSources {
            source: self.source,
            constants: self.constants,
            scoping: self.scoping,
        };
        let (inputs, replaced_attributes) = merge_class_name_inputs(element, &sources, self.edits);
        for span in replaced_attributes {
            self.edits.push(Edit {
                span,
                replacement: String::new(),
            });
        }
        format!(
            "{}([{}], {vindur_class})",
            self.helper_names.merge_class_names,
            inputs.join(", "),
        )
    }

    fn sources(&self) -> ClassNameSources<'_> {
        ClassNameSources {
            source: self.source,
            constants: self.constants,
            scoping: self.scoping,
        }
    }

    fn insert_class_name(&mut self, element: &JSXElement<'_>, expression: &str) {
        let offset = opening_attribute_insertion_offset(element, self.source);
        self.edits.push(Edit {
            span: oxc_span::Span::new(offset, offset),
            replacement: format!(" className={{{expression}}}"),
        });
    }

    fn merge_class_name_in_place(
        &mut self,
        attribute: &oxc_ast::ast::JSXAttribute<'_>,
        component: &StyledComponent,
    ) {
        let prefix = format!("{} ", component.class_name);
        if let Some(JSXAttributeValue::StringLiteral(value)) = &attribute.value {
            self.edits.push(Edit {
                span: value.span,
                replacement: wrap_jsx_string(value, self.source, &prefix, ""),
            });
            return;
        }
        let is_template = matches!(
            &attribute.value,
            Some(JSXAttributeValue::ExpressionContainer(container))
                if matches!(&container.expression, oxc_ast::ast::JSXExpression::TemplateLiteral(_))
        );
        // Both keep the edits other passes make inside the expression, like a nested css``
        let wrap = if is_template {
            wrap_class_expression(attribute, &format!("`{} ${{", component.class_name), "}`")
        } else {
            wrap_class_concat(
                attribute,
                &self.sources(),
                &format!("{} + ", js_string_literal(&prefix)),
                "",
            )
        };
        match wrap {
            Some(edits) => self.edits.extend(edits),
            None => self.edits.push(Edit {
                span: attribute.span,
                replacement: format!(
                    "className={{{} + {}}}",
                    js_string_literal(&prefix),
                    class_name_concat_source(attribute, &self.sources())
                ),
            }),
        }
    }

    fn rewrite_style_flags(&mut self, element: &JSXElement<'_>, component: &StyledComponent) {
        let flags = style_flag_classes(element, component, self.source);
        for span in &flags.attribute_spans {
            self.edits.push(Edit {
                span: *span,
                replacement: String::new(),
            });
        }
        let static_classes = flags.static_classes;
        let dynamic_classes = flags.dynamic_classes;

        let static_class_name = std::iter::once(component.class_name.as_str())
            .chain(static_classes.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join(" ");
        let suffix = dynamic_classes
            .iter()
            .map(|class| class.concat.as_str())
            .collect::<String>();
        let class_attribute = match class_name_merge(element) {
            ClassNameMerge::Runtime => {
                let vindur_class = format!("{}{suffix}", js_string_literal(&static_class_name));
                let merged = self.runtime_class_name(element, &vindur_class);
                self.insert_class_name(element, &merged);
                return;
            }
            ClassNameMerge::InPlace(attribute) => Some(attribute),
            ClassNameMerge::Insert => None,
        };
        if let Some(attribute) = class_attribute {
            let static_suffix = if static_classes.is_empty() {
                String::new()
            } else {
                format!(
                    " + {}",
                    js_string_literal(&format!(" {}", static_classes.join(" ")))
                )
            };
            // Keeps edits other passes make inside the expression, like a nested css``
            if let Some(edits) = wrap_class_concat(
                attribute,
                &self.sources(),
                &format!(
                    "{} + ",
                    js_string_literal(&format!("{} ", component.class_name))
                ),
                &format!("{static_suffix}{suffix}"),
            ) {
                self.edits.extend(edits);
                return;
            }
            let base = class_name_expression(
                attribute,
                &component.class_name,
                &static_classes,
                &self.sources(),
            );
            self.edits.push(Edit {
                span: attribute.span,
                replacement: format!("className={{{base}{suffix}}}"),
            });
        } else {
            let offset = opening_attribute_insertion_offset(element, self.source);
            self.edits.push(Edit {
                span: oxc_span::Span::new(offset, offset),
                replacement: format!(
                    " className={{{}{suffix}}}",
                    js_string_literal(&static_class_name)
                ),
            });
        }
    }
}

use super::styled_jsx_helpers::*;
