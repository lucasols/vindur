use oxc_css_parser::{
    Allocator, Span as CssSpan,
    ast::{
        AtRulePrelude, ComplexSelector, ComplexSelectorChild, CompoundSelector, InterpolableIdent,
        PseudoElementSelectorArgKind, ScopePrelude, SelectorList, SimpleSelector, Statement,
    },
};
use oxc_span::Span;

use crate::CompilerDiagnostic;

use super::{
    css_syntax::parse_style_block,
    cx_modifier_selectors::{
        SelectorArgument, class_rule_element_classes, compounds, pseudo_class_selectors,
    },
};

/// The hashed cx prop keys of a file, with the location of their first use
#[derive(Default)]
pub(crate) struct HashedCxKeys {
    pub keys: Vec<(String, Span)>,
}

impl HashedCxKeys {
    pub(crate) fn insert(&mut self, name: &str, span: Span) {
        if !self.keys.iter().any(|(key, _)| key == name) {
            self.keys.push((name.to_owned(), span));
        }
    }
}

/// A hashed cx key only renames the classes of its own element, e.g. `&.key`, so any other raw
/// `.key` class in the file's styles, like `&:has(.key)`, `& .key`, `.key &` or `.key` in another
/// component or global styles, never matches elements that get the key through cx. The modifiers
/// of other elements, like `&.key` of a component that doesn't hash it, can't select those
/// elements, so they are allowed
pub(super) fn raw_hashed_cx_key_error(
    keys: &HashedCxKeys,
    css_rules: &[String],
    file_hash: &str,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    let generated_prefix = format!("{file_hash}-");
    let selectors = keys
        .keys
        .iter()
        .map(|(name, span)| (name.as_str(), format!(".{name}"), *span))
        .collect::<Vec<_>>();
    for rule in css_rules {
        let candidates = selectors
            .iter()
            .filter(|(_, selector, _)| rule.contains(selector.as_str()))
            .collect::<Vec<_>>();
        let Some((_, _, first_span)) = candidates.first() else {
            continue;
        };
        let allocator = Allocator::default();
        let stylesheet = match parse_style_block(&allocator, rule) {
            Ok(stylesheet) => stylesheet,
            Err(error) => {
                return Some(CompilerDiagnostic::error(
                    file_path,
                    source,
                    *first_span,
                    error.message,
                ));
            }
        };
        // Only the generated rules of elements have modifiers of their own element, the `&` of
        // global styles like `html { &.key { ... } }` can be any element
        let is_element_rule = is_element_class_rule(&stylesheet.statements, &generated_prefix);
        let own_classes = if is_element_rule {
            class_rule_element_classes(&stylesheet.statements)
        } else {
            Vec::new()
        };
        let mut collector = ClassCollector::default();
        collector.statements(&stylesheet.statements);
        for (name, _, span) in candidates {
            let raw = collector.classes.iter().find(|class| {
                class.name == *name
                    && !own_classes.iter().any(|own| {
                        !own.mixed && own.start == class.span.start && own.end == class.span.end
                    })
            });
            let Some(raw) = raw else {
                continue;
            };
            // The generated class of the element rule is not written in the source
            let chain = if is_element_rule {
                raw.selectors.get(1..).unwrap_or_default()
            } else {
                &raw.selectors
            };
            return Some(CompilerDiagnostic::error(
                file_path,
                source,
                *span,
                format!(
                    "cx key \"{name}\" is hashed, so the class \".{name}\" in the selector \"{selector}\" never matches elements that get it through cx. Use \"${name}\" in the cx prop to keep the class name, or rename one of the classes",
                    selector = nested_selector_text(rule, chain)
                ),
            ));
        }
    }
    None
}

/// The selectors of nested rules as `outer { inner }`
fn nested_selector_text(css: &str, chain: &[CssSpan]) -> String {
    let mut text = String::new();
    for (index, span) in chain.iter().enumerate() {
        if index > 0 {
            text.push_str(" { ");
        }
        text.push_str(css[span.start..span.end].trim());
    }
    for _ in 1..chain.len() {
        text.push_str(" }");
    }
    text
}

/// If the statements are the generated rules of an element class of the file, e.g.
/// `.vhash-1-Box { ... }`, also inside `@layer` blocks
fn is_element_class_rule(statements: &[Statement<'_>], generated_prefix: &str) -> bool {
    !statements.is_empty()
        && statements.iter().all(|statement| match statement {
            Statement::QualifiedRule(rule) => {
                is_generated_class_selector(&rule.selector, generated_prefix)
            }
            Statement::AtRule(rule) if rule.name.name.eq_ignore_ascii_case("layer") => rule
                .block
                .as_ref()
                .is_some_and(|block| is_element_class_rule(&block.statements, generated_prefix)),
            _ => false,
        })
}

fn is_generated_class_selector(list: &SelectorList<'_>, generated_prefix: &str) -> bool {
    let [selector] = list.selectors.as_slice() else {
        return false;
    };
    let [ComplexSelectorChild::CompoundSelector(compound)] = selector.children.as_slice() else {
        return false;
    };
    matches!(
        compound.children.as_slice(),
        [SimpleSelector::Class(class)]
            if matches!(&class.name, InterpolableIdent::Literal(ident) if ident.name.starts_with(generated_prefix))
    )
}

struct SelectorClass<'c> {
    name: &'c str,
    span: CssSpan,
    /// The selectors of the rules the class is in, from the outermost one, the last one is the
    /// rule or `@scope` selector of the class
    selectors: Vec<CssSpan>,
}

/// Collects every class of the selectors, including the selector arguments of pseudo-classes and
/// pseudo-elements and the `@scope` limits
#[derive(Default)]
struct ClassCollector<'c> {
    classes: Vec<SelectorClass<'c>>,
    /// The selectors of the rules being walked
    parents: Vec<CssSpan>,
}

impl<'c> ClassCollector<'c> {
    fn statements(&mut self, statements: &'c [Statement<'c>]) {
        for statement in statements {
            match statement {
                Statement::QualifiedRule(rule) => {
                    self.selector_list(&rule.selector);
                    self.parents.push(rule.selector.span);
                    self.statements(&rule.block.statements);
                    self.parents.pop();
                }
                Statement::AtRule(rule) => {
                    if let Some(AtRulePrelude::Scope(prelude)) = &rule.prelude {
                        let limits = match prelude.as_ref() {
                            ScopePrelude::StartOnly(start) => [&start.selector, &None],
                            ScopePrelude::EndOnly(end) => [&None, &end.selector],
                            ScopePrelude::Both(both) => [&both.start.selector, &both.end.selector],
                        };
                        for list in limits.into_iter().flatten() {
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
            self.selector(selector, selector.span);
        }
    }

    fn selector(&mut self, selector: &'c ComplexSelector<'c>, outer: CssSpan) {
        for compound in compounds(selector) {
            self.compound(compound, outer);
        }
    }

    fn compound(&mut self, compound: &'c CompoundSelector<'c>, outer: CssSpan) {
        for simple in &compound.children {
            match simple {
                SimpleSelector::Class(class) => {
                    if let InterpolableIdent::Literal(ident) = &class.name {
                        let mut selectors = self.parents.clone();
                        selectors.push(outer);
                        self.classes.push(SelectorClass {
                            name: ident.name,
                            span: ident.span,
                            selectors,
                        });
                    }
                }
                SimpleSelector::PseudoClass(pseudo) => {
                    for argument in pseudo_class_selectors(pseudo) {
                        match argument {
                            SelectorArgument::Complex(selector) => self.selector(selector, outer),
                            SelectorArgument::Compound(compound) => self.compound(compound, outer),
                        }
                    }
                }
                SimpleSelector::PseudoElement(pseudo) => {
                    match pseudo.arg.as_ref().map(|arg| &arg.kind) {
                        Some(PseudoElementSelectorArgKind::CompoundSelector(compound)) => {
                            self.compound(compound, outer);
                        }
                        Some(PseudoElementSelectorArgKind::CompoundSelectorList(list)) => {
                            for compound in &list.selectors {
                                self.compound(compound, outer);
                            }
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use oxc_span::Span;

    use super::{HashedCxKeys, raw_hashed_cx_key_error};

    fn fails(rule: &str) -> bool {
        let keys = HashedCxKeys {
            keys: vec![("active".to_owned(), Span::new(0, 0))],
        };
        raw_hashed_cx_key_error(&keys, &[rule.to_owned()], "vh", "file.tsx", "").is_some()
    }

    #[test]
    fn fails_for_raw_classes_of_other_elements() {
        assert_eq!(
            [
                fails(".vh-1-Item { .active & { color: red; } }"),
                fails(".vh-1-Item { .active + & { color: red; } }"),
                fails(".vh-1-Item { .menu:not(.active) & { color: red; } }"),
                fails(".vh-1-Item { &:is(.active &) { color: red; } }"),
                fails(".active .icon { color: red; }"),
                fails(".active { color: red; }"),
                fails("@scope (.active) { .icon { color: red; } }"),
                fails(".vh-1-Item { @scope (&) to (.active) { .icon { color: red; } } }"),
                fails(".vh-1-Item { & .active { color: red; } }"),
                fails(".vh-1-Item { > .active { color: red; } }"),
                fails(".vh-1-Item { .active { color: red; } }"),
                fails(".vh-1-Item { &:has(.active) { color: red; } }"),
                fails(".vh-1-Item { &:has(+ .active) { color: red; } }"),
                fails(".vh-1-Item { & .tab { &.active { color: red; } } }"),
                fails(".vh-1-Item { &:hover, & .child { &.active { color: red; } } }"),
                fails(".vh-1-Item { &:is(.active *) { color: red; } }"),
                fails("html { &.active { color: red; } }"),
                fails("html.active { color: red; }"),
                fails(".vh-1-Item .x { &.active { color: red; } }"),
                fails(".vh-1-Item { &::slotted(.active) { color: red; } }"),
            ],
            [true; 20]
        );
    }

    #[test]
    fn allows_modifiers_of_other_components_and_other_css() {
        assert_eq!(
            [
                fails(".vh-1-Item { &.active { color: red; } }"),
                fails(".vh-1-Item { &:not(.active) { color: red; } }"),
                fails(".vh-1-Item { .list &.active { color: red; } }"),
                fails(".vh-1-Item { &:is(.active) { color: red; } }"),
                fails(".vh-1-Item { &.active .icon { color: red; } }"),
                fails(".vh-1-Item { /* .active & */ color: red; }"),
                fails(".vh-1-Item { background: url(/a.active); content: \".active &\"; }"),
                fails(".vh-1-Item { .active-extra & { color: red; } }"),
                fails(".vh-1-Item { &:active, &.inactive { color: red; } }"),
                fails("@layer base { .vh-1-Item { &.active { color: red; } } }"),
            ],
            [false; 10]
        );
    }
}
