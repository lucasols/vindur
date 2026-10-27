use oxc_ast::ast::{
    JSXAttribute, JSXAttributeValue, JSXElement, JSXElementName, JSXExpression, ObjectPropertyKind,
    Program, PropertyKind,
};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::Scoping;
use oxc_span::GetSpan;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    CompilerDiagnostic,
    edit::{Edit, take_edited_source},
    facts::StaticValue,
};

use super::{
    css::clean_css,
    css_syntax::CssError,
    cx_modifier_selectors::{ModifierCss, element_class_names, rewrites_any},
    jsx_attributes::{
        find_attribute, find_last_attribute, jsx_name, opening_attribute_insertion_offset,
    },
    jsx_class_name::{
        ClassNameMerge, ClassNameSources, class_name_merge, emit_class_concat,
        merge_class_name_inputs,
    },
    jsx_css::is_foreign_css_attribute,
    jsx_cx_attribute::{is_foreign_cx_attribute, is_foreign_styled_cx_attribute},
    jsx_cx_component_references::HashedStyledModifier,
    jsx_cx_css_references::{
        CssReference, css_references, failing_modifier, rewrite_class_rules,
        unsupported_css_reference_modifiers, wrapped_css_reference_modifiers,
        wrapped_css_references,
    },
    runtime_helpers::RuntimeHelperNames,
    static_value::{TemplateContext, evaluate_template},
    styled::{StyledComponent, styled_ref_placeholder},
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
    /// The id after the hashed cx classes, where the css prop's scoped variables start
    pub next_index: u32,
}

pub(crate) struct JsxCxTransform<'a> {
    pub constants: &'a FxHashMap<String, StaticValue>,
    pub scoping: &'a Scoping,
    pub styled_components: &'a FxHashMap<String, StyledComponent>,
    pub exported_names: &'a FxHashSet<String>,
    pub file_hash: &'a str,
    pub file_path: &'a str,
    pub source: &'a str,
    pub dev: bool,
    pub id_index: &'a mut u32,
    pub id_starts: &'a FxHashMap<u32, u32>,
    pub edits: &'a mut Vec<Edit>,
    pub css_rules: &'a mut Vec<String>,
    pub elements: &'a mut FxHashMap<u32, CxElementTransform>,
    pub hashed_styled_modifiers: &'a mut Vec<HashedStyledModifier>,
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
        modifier_forms: FxHashMap::default(),
        renamed_modifiers: FxHashSet::default(),
        extended_declarations: FxHashMap::default(),
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
    /// Whether each `(rules owner, class)` modifier is used hashed, the owner rules are renamed
    /// for hashed keys, so a `$` key of the same class would stop matching them
    modifier_forms: FxHashMap<(String, String), bool>,
    /// The `(rules owner, class)` modifiers already renamed in the owner rules, hashed names only
    /// depend on the owner, so later elements using them don't parse the rules again
    renamed_modifiers: FxHashSet<(String, String)>,
    /// The element classes declared in the rules of each extended styled component class
    extended_declarations: FxHashMap<String, Vec<String>>,
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
        if object.properties.is_empty() {
            self.set_error(
                object.span,
                "cx prop object must not be empty, remove the cx prop instead".to_owned(),
            );
            return;
        }

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
        let css_references = css_references(
            element,
            self.output.constants,
            self.output.scoping,
            self.output.exported_names,
        );
        let has_css_context = styled.is_some() || has_vindur_css || !css_references.is_empty();
        // Css reference rules are rewritten in place and can be combined in any way across
        // elements, so all of them share a single file-wide index per modifier name. Styled
        // components are keyed by their class, which `withComponent()` variants share
        let context_key = match (&styled, css_references.is_empty()) {
            (Some(styled), _) => format!("styled:{}", styled.class_name),
            (None, false) => "css-ref".to_owned(),
            (None, true) => format!("css:{}", element.span.start),
        };
        let owners = ModifierOwners::new(element, styled.as_ref(), has_vindur_css, &css_references);
        let css_index = if has_vindur_css {
            let index = *self.output.id_index;
            *self.output.id_index += 1;
            Some(index)
        } else {
            None
        };
        let mut properties = Vec::new();
        let mut mappings = Vec::new();
        let mut key_spans = Vec::new();
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
            if let Some(message) = invalid_cx_key_message(&class_name) {
                self.set_error(property.key.span(), message);
                return;
            }
            if !has_css_context && !class_name.starts_with('$') {
                self.set_error(
                    attribute.span,
                    "cx prop on plain DOM elements requires classes to use $ prefix (e.g., $className) when not used with css prop or styled components. This ensures you're referencing external CSS classes."
                        .to_owned(),
                );
                return;
            }
            let hashed = !class_name.starts_with('$');
            if let Some(message) = self.mixed_modifier_form(&owners, &class_name, hashed) {
                self.set_error(property.key.span(), message);
                return;
            }
            let is_extended = match &styled {
                Some(styled) if hashed => self.is_extended_modifier(styled, &class_name),
                _ => Ok(false),
            };
            let is_extended = match is_extended {
                Ok(is_extended) => is_extended,
                Err(error) => {
                    self.set_error(property.key.span(), error.message);
                    return;
                }
            };
            if is_extended {
                self.set_error(
                    property.key.span(),
                    format!(
                        "cx prop class \"{class_name}\" can't be hashed on styled component \"{element_name}\", its \"&.{class_name}\" styles are declared in the styled component it extends. Move the modifier styles into \"{element_name}\" or use a $-prefixed class (e.g. ${class_name})."
                    ),
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
                    if let Some(styled) = &styled {
                        self.record_hashed_styled_modifier(
                            styled,
                            &class_name,
                            element_name,
                            property.key.span(),
                        );
                    }
                    (self.hashed_class_name(index, &class_name), true)
                };
            let value_span = property.value.span();
            // The value is copied into the generated call, with the edits of other passes inside
            // it, like a `stableId()` call
            let value = take_edited_source(self.output.source, value_span, self.output.edits);
            properties.push(format!("{}: {value}", js_string_literal(&output_name)));
            mappings.push((class_name, output_name, should_rewrite_css));
            key_spans.push(property.key.span());
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
        let wrapped_references = wrapped_css_references(
            element,
            self.output.constants,
            self.output.scoping,
            self.output.exported_names,
        );
        if let Some((span, message)) =
            wrapped_css_reference_modifiers(&wrapped_references, &mappings, &self.renamed_modifiers)
        {
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
            let missing = match self.missing_styled_classes(element, styled, &mappings) {
                Ok(missing) => missing,
                Err(error) => {
                    self.set_error(attribute.span, error.message);
                    return;
                }
            };
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

        let rules_owners = match &styled {
            Some(styled) => styled
                .class_name
                .split_whitespace()
                .last()
                .map(str::to_owned)
                .into_iter()
                .collect(),
            None => css_references
                .iter()
                .map(|reference| reference.name().to_owned())
                .collect::<Vec<_>>(),
        };
        if let Err((error, failing)) = self.rewrite_owner_rules(&rules_owners, &mappings) {
            let span = failing
                .and_then(|failing| {
                    mappings
                        .iter()
                        .position(|(original, _, _)| *original == failing)
                })
                .and_then(|index| key_spans.get(index).copied())
                .unwrap_or(attribute.span);
            self.set_error(span, error.message);
            return;
        }
        let cx_call = format!(
            "{}({{\n{},\n}})",
            self.output.helper_names.cx,
            properties.join(",\n")
        );
        if let Some(css_index) = css_index {
            self.output.elements.insert(
                element.span.start,
                CxElementTransform {
                    call: cx_call,
                    mappings,
                    css_index,
                    next_index: *self.output.id_index,
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

    fn hashed_class_name(&self, index: u32, class_name: &str) -> String {
        if self.output.dev {
            format!("{}-{index}-{class_name}", self.output.file_hash)
        } else {
            format!("{}-{index}", self.output.file_hash)
        }
    }

    /// If a styled component `styled` extends declares the class in its rules, e.g. `active` for
    /// `&.active` in `Base` of `styled(Base)`, also when cx props of that component already renamed
    /// it. Their rules are only renamed for cx props of the extended component
    fn is_extended_modifier(
        &mut self,
        styled: &StyledComponent,
        class_name: &str,
    ) -> Result<bool, CssError> {
        let classes = styled.class_name.split_whitespace().collect::<Vec<_>>();
        for index in 0..classes.len().saturating_sub(1) {
            let class = classes[index];
            if !self.extended_declarations.contains_key(class) {
                let mut declared = Vec::new();
                for rule in self
                    .output
                    .css_rules
                    .iter()
                    .filter(|rule| is_class_rule(rule, class))
                {
                    declared.extend(element_class_names(rule, ModifierCss::ClassRule)?);
                }
                self.extended_declarations
                    .insert(class.to_owned(), declared);
            }
            let declared = &self.extended_declarations[class];
            let context_key = format!("styled:{}", classes[..=index].join(" "));
            let renamed = self
                .class_indices
                .get(&format!("{context_key}:{class_name}"))
                .is_some_and(|index| {
                    declared.contains(&self.hashed_class_name(*index, class_name))
                });
            if renamed || declared.iter().any(|declared| declared == class_name) {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// Records the first hashed use of each styled component class, to reject selecting it
    /// through a component reference in other styles
    fn record_hashed_styled_modifier(
        &mut self,
        styled: &StyledComponent,
        class_name: &str,
        element_name: &str,
        span: oxc_span::Span,
    ) {
        if self.output.hashed_styled_modifiers.iter().any(|modifier| {
            modifier.class_name == class_name && modifier.classes.join(" ") == styled.class_name
        }) {
            return;
        }
        let classes = styled
            .class_name
            .split_whitespace()
            .map(str::to_owned)
            .collect::<Vec<_>>();
        let placeholders = self
            .output
            .styled_components
            .iter()
            .filter(|(_, component)| {
                component
                    .class_name
                    .split_whitespace()
                    .last()
                    .is_some_and(|class| classes.iter().any(|own| own == class))
            })
            .map(|(name, _)| styled_ref_placeholder(name))
            .collect();
        self.output
            .hashed_styled_modifiers
            .push(HashedStyledModifier {
                classes,
                placeholders,
                class_name: class_name.to_owned(),
                element_name: element_name.to_owned(),
                span,
            });
    }

    fn missing_styled_classes(
        &self,
        element: &JSXElement<'_>,
        styled: &StyledComponent,
        mappings: &[(String, String, bool)],
    ) -> Result<Vec<String>, CssError> {
        let Some(base_class) = styled
            .class_name
            .split_whitespace()
            .last()
            .filter(|_| rewrites_any(mappings))
        else {
            return Ok(Vec::new());
        };
        let mut declared = self.css_prop_class_names(element);
        for rule in self
            .output
            .css_rules
            .iter()
            .filter(|rule| is_class_rule(rule, base_class))
        {
            declared.extend(element_class_names(rule, ModifierCss::ClassRule)?);
        }
        Ok(mappings
            .iter()
            .filter(|(original, hashed, should_rewrite)| {
                *should_rewrite && !declared.contains(original) && !declared.contains(hashed)
            })
            .map(|(original, _, _)| original.clone())
            .collect())
    }

    /// The element classes declared in the element css prop template, e.g. `active` in
    /// `` css={`&.active { ... }`} ``
    fn css_prop_class_names(&self, element: &JSXElement<'_>) -> Vec<String> {
        let Some(JSXAttributeValue::ExpressionContainer(container)) =
            find_attribute(element, "css").and_then(|attribute| attribute.value.as_ref())
        else {
            return Vec::new();
        };
        let JSXExpression::TemplateLiteral(template) = &container.expression else {
            return Vec::new();
        };
        // Invalid templates are reported with their location by the css prop pass
        let Ok(content) = evaluate_template(
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
        ) else {
            return Vec::new();
        };
        element_class_names(&clean_css(&content), ModifierCss::Block).unwrap_or_default()
    }

    /// Renames the hashed modifiers in the rules of each owner, the error has the class it failed
    /// on, if any
    fn rewrite_owner_rules(
        &mut self,
        owners: &[String],
        mappings: &[(String, String, bool)],
    ) -> Result<(), (CssError, Option<String>)> {
        for owner in owners {
            let pending = mappings
                .iter()
                .filter(|(original, _, should_rewrite)| {
                    *should_rewrite
                        && self
                            .renamed_modifiers
                            .insert((owner.clone(), original.clone()))
                })
                .cloned()
                .collect::<Vec<_>>();
            let owners = std::slice::from_ref(owner);
            if let Err(error) = rewrite_class_rules(self.output.css_rules, owners, &pending) {
                let failing = failing_modifier(self.output.css_rules, owners, &pending);
                return Err((error, failing.map(str::to_owned)));
            }
        }
        Ok(())
    }

    /// Fails when a class of rules shared with other elements is used both hashed and as a `$`
    /// key, e.g. `cx={{ active }}` and `cx={{ $active }}` on the same styled component
    fn mixed_modifier_form(
        &mut self,
        owners: &ModifierOwners,
        key: &str,
        hashed: bool,
    ) -> Option<String> {
        let class_name = key.strip_prefix('$').unwrap_or(key);
        let owners = if hashed {
            &owners.hashed
        } else {
            &owners.unhashed
        };
        let mut mixed = false;
        for owner in owners {
            let form = self
                .modifier_forms
                .entry((owner.clone(), class_name.to_owned()))
                .or_insert(hashed);
            mixed |= *form != hashed;
        }
        mixed.then(|| {
            format!(
                "cx prop class \"{class_name}\" is used both hashed and as \"${class_name}\" with the same styles, hashing renames their \"&.{class_name}\" selectors so \"${class_name}\" would stop matching. Use the same key in all cx props of these styles."
            )
        })
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

/// The rules each cx key class can be declared in, so their modifiers are shared with other
/// elements using them
struct ModifierOwners {
    /// The rules renamed for hashed keys
    hashed: Vec<String>,
    /// The rules a `$` key class can match
    unhashed: Vec<String>,
}

impl ModifierOwners {
    fn new(
        element: &JSXElement<'_>,
        styled: Option<&StyledComponent>,
        has_vindur_css: bool,
        css_references: &[CssReference],
    ) -> Self {
        let styled_class = styled
            .and_then(|styled| styled.class_name.split_whitespace().last())
            .map(str::to_owned);
        let references = css_references
            .iter()
            .map(|reference| reference.name().to_owned())
            .collect::<Vec<_>>();
        let css_prop = has_vindur_css.then(|| format!("css:{}", element.span.start));
        // Css references of a styled component are not renamed, see
        // `unsupported_css_reference_modifiers`
        let hashed = match &styled_class {
            Some(class) => vec![class.clone()],
            None => references.clone(),
        };
        // A `$` key class also matches the rules of the extended styled components
        let styled_classes = styled
            .into_iter()
            .flat_map(|styled| styled.class_name.split_whitespace().map(str::to_owned));
        Self {
            hashed: hashed.into_iter().chain(css_prop.clone()).collect(),
            unhashed: styled_classes.chain(references).chain(css_prop).collect(),
        }
    }
}

fn class_name_sources<'a>(output: &JsxCxTransform<'a>) -> ClassNameSources<'a> {
    ClassNameSources {
        source: output.source,
        constants: output.constants,
        scoping: output.scoping,
    }
}

// Hashed keys become part of class names and `&.key` selectors, so they must be plain CSS
// identifiers. `$` keys are external classes, like Tailwind's `hover:underline`, so only a
// single class is required
fn invalid_cx_key_message(key: &str) -> Option<String> {
    if let Some(external) = key.strip_prefix('$') {
        let is_single_class = !external.is_empty()
            && !external.chars().any(char::is_whitespace)
            && external != "__proto__";
        return (!is_single_class).then(|| {
            format!(
                "cx prop key \"{key}\" must be a single class name, use one key per class, eg. {{ $first: on, $second: on }}"
            )
        });
    }
    // `---name` classes would be renamed as scoped variables
    if key.starts_with("---") {
        return Some(format!(
            "cx prop key \"{key}\" must not start with ---, which is reserved for scoped variables, eg. {{ active: on }}"
        ));
    }
    let mut characters = key.chars();
    let is_identifier = characters
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '_' || first == '-')
        && characters.all(|character| {
            character.is_ascii_alphanumeric() || character == '_' || character == '-'
        })
        && key != "__proto__";
    (!is_identifier).then(|| {
        format!(
            "cx prop key \"{key}\" must be a plain class name with letters, digits, - and _, not starting with a digit, eg. {{ active: on }}, or a $-prefixed external class"
        )
    })
}
