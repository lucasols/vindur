use oxc_ast::ast::{JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXElement};
use oxc_ast_visit::{Visit, walk};
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use crate::{CompilerDiagnostic, edit::Edit};

use super::styled::StyledComponent;

pub(crate) struct StyledJsxTransform<'a> {
    pub components: &'a FxHashMap<String, StyledComponent>,
    pub constants: &'a FxHashMap<String, crate::facts::StaticValue>,
    pub edits: &'a mut Vec<Edit>,
    pub file_path: &'a str,
    pub source: &'a str,
    pub needs_cx_helper: &'a mut bool,
    pub needs_merge_helper: &'a mut bool,
}

pub(crate) fn rewrite_styled_jsx(
    program: &oxc_ast::ast::Program<'_>,
    output: StyledJsxTransform<'_>,
) -> Result<(), CompilerDiagnostic> {
    let mut visitor = StyledJsxVisitor {
        components: output.components,
        constants: output.constants,
        edits: output.edits,
        file_path: output.file_path,
        source: output.source,
        needs_cx_helper: output.needs_cx_helper,
        needs_merge_helper: output.needs_merge_helper,
        diagnostic: None,
    };
    visitor.visit_program(program);
    visitor.diagnostic.map_or(Ok(()), Err)
}

struct StyledJsxVisitor<'c, 'e, 's> {
    components: &'c FxHashMap<String, StyledComponent>,
    constants: &'c FxHashMap<String, crate::facts::StaticValue>,
    edits: &'e mut Vec<Edit>,
    file_path: &'s str,
    source: &'s str,
    needs_cx_helper: &'e mut bool,
    needs_merge_helper: &'e mut bool,
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

        let spreads = match styled_spread_sources(element, self.source) {
            Ok(spreads) => spreads,
            Err(spread) => {
                self.diagnostic = Some(CompilerDiagnostic::error(
                    self.file_path,
                    self.source,
                    spread.span,
                    format!(
                        "Unsupported spread expression \"{}\" used in vindur styled component. Only references to variables are allowed in spread expressions. Extract them to a variable and use that variable in the spread expression.",
                        format_spread_expression(&spread.source)
                    ),
                ));
                return;
            }
        };

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
                    "cx" => true,
                    "css" => css_attribute_is_compile_time(attribute, self.constants),
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
            name.name.as_str() == "css" && !css_attribute_is_compile_time(attribute, self.constants)
        });

        if !component.style_flags.is_empty() && !has_compile_time_class_attribute {
            self.rewrite_style_flags(element, component, has_dynamic_css_attribute);
        } else if has_compile_time_class_attribute {
            // The JSX prop passes emit the combined styled and generated class names.
        } else if let Some(last_spread) = spreads.last()
            && let class_attributes = class_name_attributes(element)
            && class_attributes
                .last()
                .is_none_or(|attribute| attribute.span.start < last_spread.start)
        {
            *self.needs_merge_helper = true;
            let mut inputs = Vec::new();
            for item in &element.opening_element.attributes {
                match item {
                    JSXAttributeItem::SpreadAttribute(spread) => {
                        let span = spread.argument.span();
                        inputs.push(self.source[span.start as usize..span.end as usize].to_owned());
                    }
                    JSXAttributeItem::Attribute(attribute)
                        if is_named_attribute(attribute, "className") =>
                    {
                        inputs.push(class_name_value_source(attribute, self.source));
                        self.edits.push(Edit {
                            span: attribute.span,
                            replacement: String::new(),
                        });
                    }
                    _ => {}
                }
            }
            let offset = opening_attribute_insertion_offset(element, self.source);
            self.edits.push(Edit {
                span: oxc_span::Span::new(offset, offset),
                replacement: format!(
                    " className={{mergeClassNames([{}], \"{}\")}}",
                    inputs.join(", "),
                    component.class_name
                ),
            });
        } else if let Some(attribute) = element.opening_element.attributes.iter().find_map(|item| {
            let JSXAttributeItem::Attribute(attribute) = item else {
                return None;
            };
            let JSXAttributeName::Identifier(name) = &attribute.name else {
                return None;
            };
            (name.name.as_str() == "className").then_some(attribute)
        }) {
            if let Some(JSXAttributeValue::StringLiteral(value)) = &attribute.value {
                self.edits.push(Edit {
                    span: value.span,
                    replacement: format!("\"{} {}\"", component.class_name, value.value),
                });
            } else if matches!(
                &attribute.value,
                Some(JSXAttributeValue::ExpressionContainer(container))
                    if matches!(&container.expression, oxc_ast::ast::JSXExpression::TemplateLiteral(_))
            ) {
                self.edits.push(Edit {
                    span: attribute.span,
                    replacement: format!(
                        "className={{`{} ${{{}}}`}}",
                        component.class_name,
                        class_name_value_source(attribute, self.source)
                    ),
                });
            } else {
                self.edits.push(Edit {
                    span: attribute.span,
                    replacement: format!(
                        "className={{[\"{}\", {}].filter(Boolean).join(\" \")}}",
                        component.class_name,
                        class_name_value_source(attribute, self.source)
                    ),
                });
            }
        } else {
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
    fn rewrite_style_flags(
        &mut self,
        element: &JSXElement<'_>,
        component: &StyledComponent,
        has_dynamic_css_attribute: bool,
    ) {
        let mut static_classes = Vec::new();
        let mut dynamic_classes = Vec::new();
        for item in &element.opening_element.attributes {
            let JSXAttributeItem::Attribute(attribute) = item else {
                continue;
            };
            let JSXAttributeName::Identifier(name) = &attribute.name else {
                continue;
            };
            let Some(flag) = component
                .style_flags
                .iter()
                .find(|flag| flag.prop_name == name.name.as_str())
            else {
                continue;
            };
            self.edits.push(Edit {
                span: attribute.span,
                replacement: String::new(),
            });
            collect_flag_class(
                attribute,
                flag,
                self.source,
                &mut static_classes,
                &mut dynamic_classes,
            );
        }

        let static_class_name = std::iter::once(component.class_name.as_str())
            .chain(static_classes.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join(" ");
        let suffix = dynamic_classes
            .iter()
            .map(|class| class.concat.as_str())
            .collect::<String>();
        let spreads = jsx_spread_sources(element, self.source);
        if has_dynamic_css_attribute {
            *self.needs_cx_helper = true;
            let mut cx_arguments = static_classes
                .iter()
                .map(|class| format!("\"{class}\""))
                .chain(dynamic_classes.iter().map(|class| class.cx.clone()))
                .collect::<Vec<_>>();
            if let Some(attribute) = element.opening_element.attributes.iter().find_map(|item| {
                let JSXAttributeItem::Attribute(attribute) = item else {
                    return None;
                };
                is_named_attribute(attribute, "className").then_some(&**attribute)
            }) {
                cx_arguments.insert(0, class_name_value_source(attribute, self.source));
                self.edits.push(Edit {
                    span: attribute.span,
                    replacement: String::new(),
                });
            }
            cx_arguments.insert(
                0,
                format!(
                    "`{} ${{\"{}\"}}`",
                    component.class_name, component.class_name
                ),
            );
            let offset = opening_attribute_insertion_offset(element, self.source);
            self.edits.push(Edit {
                span: oxc_span::Span::new(offset, offset),
                replacement: format!(" className={{cx({})}}", cx_arguments.join(", ")),
            });
            return;
        }
        if !spreads.is_empty() {
            *self.needs_merge_helper = true;
            *self.needs_cx_helper = true;
            let mut cx_arguments = static_classes
                .iter()
                .map(|class| format!("\"{class}\""))
                .chain(dynamic_classes.iter().map(|class| class.cx.clone()))
                .collect::<Vec<_>>();
            cx_arguments.insert(
                0,
                format!(
                    "mergeClassNames([{}], \"{}\")",
                    spreads.join(", "),
                    component.class_name
                ),
            );
            let offset = opening_attribute_insertion_offset(element, self.source);
            self.edits.push(Edit {
                span: oxc_span::Span::new(offset, offset),
                replacement: format!(" className={{cx({})}}", cx_arguments.join(", ")),
            });
            return;
        }
        if let Some(attribute) = element.opening_element.attributes.iter().find_map(|item| {
            let JSXAttributeItem::Attribute(attribute) = item else {
                return None;
            };
            let JSXAttributeName::Identifier(name) = &attribute.name else {
                return None;
            };
            (name.name.as_str() == "className").then_some(attribute)
        }) {
            let base = class_name_expression(
                attribute,
                &component.class_name,
                &static_classes,
                self.source,
            );
            self.edits.push(Edit {
                span: attribute.span,
                replacement: format!("className={{{base}{suffix}}}"),
            });
        } else {
            let offset = opening_attribute_insertion_offset(element, self.source);
            self.edits.push(Edit {
                span: oxc_span::Span::new(offset, offset),
                replacement: format!(" className={{\"{static_class_name}\"{suffix}}}"),
            });
        }
    }
}

use super::styled_jsx_helpers::*;
