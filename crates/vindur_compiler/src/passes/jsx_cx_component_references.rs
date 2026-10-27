use oxc_css_parser::{
    Allocator,
    ast::{
        AtRulePrelude, ComplexSelector, CompoundSelector, InterpolableIdent, ScopePrelude,
        SelectorList, SimpleSelector, Statement, TypeSelector,
    },
};
use oxc_span::Span;

use crate::CompilerDiagnostic;

use super::{
    css_syntax::parse_style_block,
    cx_modifier_selectors::{SelectorArgument, compounds, matches_element, pseudo_class_selectors},
};

/// A cx class hashed on a styled component. Other styles selecting the component through a
/// component reference keep the original class, e.g. `.active` in `${Item}.active`
pub(crate) struct HashedStyledModifier {
    /// The classes of the styled component elements, with the classes of the components it extends
    pub classes: Vec<String>,
    /// The forward reference placeholders of the styled components with these classes
    pub placeholders: Vec<String>,
    pub class_name: String,
    pub element_name: String,
    pub span: Span,
}

/// Fails when a hashed cx class of a styled component is selected through a component reference,
/// e.g. `${Item}.active` in another styled component with `<Item cx={{ active }} />`
pub(crate) fn component_reference_modifier_error(
    css_rules: &[String],
    modifiers: &[HashedStyledModifier],
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    for rule in css_rules {
        let candidates = modifiers
            .iter()
            .filter(|modifier| {
                rule.contains(modifier.class_name.as_str())
                    && modifier
                        .classes
                        .iter()
                        .chain(&modifier.placeholders)
                        .any(|name| rule.contains(name.as_str()))
            })
            .collect::<Vec<_>>();
        let Some(first) = candidates.first() else {
            continue;
        };
        let allocator = Allocator::default();
        let stylesheet = match parse_style_block(&allocator, rule) {
            Ok(stylesheet) => stylesheet,
            Err(error) => {
                return Some(CompilerDiagnostic::error(
                    file_path,
                    source,
                    first.span,
                    error.message,
                ));
            }
        };
        for modifier in candidates {
            let mut collector = ReferencedClassCollector {
                modifier,
                classes: Vec::new(),
            };
            collector.statements(&stylesheet.statements);
            if collector.classes.contains(&modifier.class_name.as_str()) {
                return Some(CompilerDiagnostic::error(
                    file_path,
                    source,
                    modifier.span,
                    format!(
                        "cx prop class \"{0}\" can't be hashed on styled component \"{1}\", other styles select it through a component reference, like \"${{{1}}}.{0}\", which would stop matching. Use a $-prefixed class (e.g. ${0}) or a style flag.",
                        modifier.class_name, modifier.element_name
                    ),
                ));
            }
        }
    }
    None
}

/// Collects the classes used with a reference to the styled component in a compound, e.g.
/// `active` in `.item.active` or `.item:not(.active)`
struct ReferencedClassCollector<'m, 'c> {
    modifier: &'m HashedStyledModifier,
    classes: Vec<&'c str>,
}

impl<'c> ReferencedClassCollector<'_, 'c> {
    fn statements(&mut self, statements: &'c [Statement<'c>]) {
        for statement in statements {
            match statement {
                Statement::QualifiedRule(rule) => {
                    self.selector_list(&rule.selector);
                    self.statements(&rule.block.statements);
                }
                Statement::AtRule(rule) => {
                    if let Some(AtRulePrelude::Scope(prelude)) = &rule.prelude {
                        let (start, end) = match prelude.as_ref() {
                            ScopePrelude::StartOnly(start) => (&start.selector, &None),
                            ScopePrelude::EndOnly(end) => (&None, &end.selector),
                            ScopePrelude::Both(both) => (&both.start.selector, &both.end.selector),
                        };
                        for list in [start, end].into_iter().flatten() {
                            self.selector_list(list);
                        }
                    }
                    if let Some(block) = &rule.block {
                        self.statements(&block.statements);
                    }
                }
                _ => {}
            }
        }
    }

    fn selector_list(&mut self, list: &'c SelectorList<'c>) {
        for selector in &list.selectors {
            self.selector(selector, false);
        }
    }

    /// `inherited` is when the subject is the component, e.g. `.a` in `.item:not(.a)`
    fn selector(&mut self, selector: &'c ComplexSelector<'c>, inherited: bool) {
        let compounds = compounds(selector);
        let subject = compounds.len().saturating_sub(1);
        for (index, compound) in compounds.into_iter().enumerate() {
            self.compound(compound, inherited && index == subject);
        }
    }

    fn compound(&mut self, compound: &'c CompoundSelector<'c>, inherited: bool) {
        let is_component = inherited
            || compound
                .children
                .iter()
                .any(|simple| self.is_reference(simple));
        for simple in &compound.children {
            match simple {
                SimpleSelector::Class(class) if is_component => {
                    if let InterpolableIdent::Literal(ident) = &class.name {
                        self.classes.push(ident.name);
                    }
                }
                SimpleSelector::PseudoClass(pseudo) => {
                    let inherited = is_component && matches_element(pseudo);
                    for argument in pseudo_class_selectors(pseudo) {
                        match argument {
                            SelectorArgument::Complex(selector) => {
                                self.selector(selector, inherited);
                            }
                            SelectorArgument::Compound(compound) => {
                                self.compound(compound, inherited);
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    fn is_reference(&self, simple: &SimpleSelector<'_>) -> bool {
        let (names, name) = match simple {
            SimpleSelector::Class(class) => (&self.modifier.classes, &class.name),
            SimpleSelector::Type(TypeSelector::TagName(tag)) => {
                (&self.modifier.placeholders, &tag.name.name)
            }
            _ => return false,
        };
        let InterpolableIdent::Literal(ident) = name else {
            return false;
        };
        names.iter().any(|reference| reference == ident.name)
    }
}

#[cfg(test)]
mod tests {
    use oxc_span::Span;

    use super::{HashedStyledModifier, component_reference_modifier_error};

    fn rejects(rule: &str) -> bool {
        let modifiers = [HashedStyledModifier {
            classes: vec!["item".to_owned()],
            placeholders: vec!["__VINDUR_STYLED_REF_49__".to_owned()],
            class_name: "active".to_owned(),
            element_name: "Item".to_owned(),
            span: Span::new(0, 0),
        }];
        component_reference_modifier_error(&[rule.to_owned()], &modifiers, "file.tsx", "").is_some()
    }

    #[test]
    fn rejects_hashed_classes_selected_through_component_references() {
        assert_eq!(
            [
                ".list { & .item.active { color: red; } }",
                ".list { & .item:not(.active) { color: red; } }",
                ".list:has(.item.active) { color: red; }",
                ".list { & __VINDUR_STYLED_REF_49__.active { color: red; } }",
                "@scope (.item.active) { .x { color: red; } }",
            ]
            .map(rejects),
            [true; 5]
        );
    }

    #[test]
    fn allows_other_classes_and_elements() {
        assert_eq!(
            [
                ".item { &.v-1-active { color: red; } }",
                ".list { & .item .active { color: red; } }",
                ".list { & .item:has(.active) { color: red; } }",
                ".list.active { & .item { color: red; } }",
                ".list { & .item.active-x { color: red; } }",
            ]
            .map(rejects),
            [false; 5]
        );
    }
}
