use oxc_css_parser::{
    Allocator, Span as CssSpan,
    ast::{
        AtRulePrelude, ComplexSelector, CompoundSelector, InterpolableIdent, ScopePrelude,
        SelectorList, SimpleSelector, Statement,
    },
};
use oxc_span::Span;

use crate::CompilerDiagnostic;

use super::{
    css_syntax::parse_style_block,
    cx_modifier_selectors::{
        ModifierCss, SelectorArgument, compounds, element_classes, pseudo_class_selectors,
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
/// component, never matches elements that get the key through cx. The modifiers of other
/// elements, like `&.key` of a component that doesn't hash it, can't select those elements, so
/// they are allowed
pub(super) fn raw_hashed_cx_key_error(
    keys: &HashedCxKeys,
    css_rules: &[String],
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    for rule in css_rules {
        let candidates = keys
            .keys
            .iter()
            .filter(|(name, _)| rule.contains(name.as_str()))
            .collect::<Vec<_>>();
        let Some((_, first_span)) = candidates.first() else {
            continue;
        };
        let error = |message| CompilerDiagnostic::error(file_path, source, *first_span, message);
        let allocator = Allocator::default();
        let stylesheet = match parse_style_block(&allocator, rule) {
            Ok(stylesheet) => stylesheet,
            Err(error_message) => return Some(error(error_message.message)),
        };
        let own_classes = match element_classes(rule, ModifierCss::ClassRule) {
            Ok(classes) => classes,
            Err(error_message) => return Some(error(error_message.message)),
        };
        let mut collector = ClassCollector::default();
        collector.statements(&stylesheet.statements);
        for (name, span) in candidates {
            let raw = collector.classes.iter().find(|class| {
                class.name == name
                    && !own_classes.iter().any(|own| {
                        !own.mixed && own.start == class.span.start && own.end == class.span.end
                    })
            });
            let Some(raw) = raw else {
                continue;
            };
            return Some(CompilerDiagnostic::error(
                file_path,
                source,
                *span,
                format!(
                    "cx key \"{name}\" is hashed, so the class \".{name}\" in the selector \"{selector}\" never matches elements that get it through cx. Use \"${name}\" in the cx prop to keep the class name, or rename one of the classes",
                    selector = rule[raw.selector.start..raw.selector.end].trim()
                ),
            ));
        }
    }
    None
}

struct SelectorClass<'c> {
    name: &'c str,
    span: CssSpan,
    /// The rule or `@scope` selector the class is in
    selector: CssSpan,
}

/// Collects every class of the selectors, including the selector arguments of pseudo-classes and
/// the `@scope` limits
#[derive(Default)]
struct ClassCollector<'c> {
    classes: Vec<SelectorClass<'c>>,
}

impl<'c> ClassCollector<'c> {
    fn statements(&mut self, statements: &'c [Statement<'c>]) {
        for statement in statements {
            match statement {
                Statement::QualifiedRule(rule) => {
                    self.selector_list(&rule.selector);
                    self.statements(&rule.block.statements);
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
                        self.classes.push(SelectorClass {
                            name: ident.name,
                            span: ident.span,
                            selector: outer,
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
        raw_hashed_cx_key_error(&keys, &[rule.to_owned()], "file.tsx", "").is_some()
    }

    #[test]
    fn fails_for_raw_classes_of_other_elements() {
        assert_eq!(
            [
                fails(".item { .active & { color: red; } }"),
                fails(".item { .active + & { color: red; } }"),
                fails(".item { .menu:not(.active) & { color: red; } }"),
                fails(".item { &:is(.active &) { color: red; } }"),
                fails(".active .icon { color: red; }"),
                fails(".active { color: red; }"),
                fails("@scope (.active) { .icon { color: red; } }"),
                fails(".item { @scope (&) to (.active) { .icon { color: red; } } }"),
                fails(".item { & .active { color: red; } }"),
                fails(".item { > .active { color: red; } }"),
                fails(".item { .active { color: red; } }"),
                fails(".item { &:has(.active) { color: red; } }"),
                fails(".item { &:has(+ .active) { color: red; } }"),
                fails(".item { & .tab { &.active { color: red; } } }"),
                fails(".item { &:hover, & .child { &.active { color: red; } } }"),
                fails(".item { &:is(.active *) { color: red; } }"),
            ],
            [true; 16]
        );
    }

    #[test]
    fn allows_modifiers_of_other_components_and_other_css() {
        assert_eq!(
            [
                fails(".item { &.active { color: red; } }"),
                fails(".item { &:not(.active) { color: red; } }"),
                fails(".item { .list &.active { color: red; } }"),
                fails(".item { &:is(.active) { color: red; } }"),
                fails(".item { &.active .icon { color: red; } }"),
                fails(".item { /* .active & */ color: red; }"),
                fails(".item { background: url(/a.active); content: \".active &\"; }"),
                fails(".item { .active-extra & { color: red; } }"),
            ],
            [false; 8]
        );
    }
}
