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
/// in the rules of other elements, like `&.key` of a component that doesn't hash it, can't select
/// those elements, so they are allowed, global styles are always checked. `hashed_owners` are the `(element class, key)` pairs whose
/// rules had the key renamed, or whose elements get the hashed class without renaming them, like
/// a css reference of a styled component. A raw modifier left in a rule of these classes never
/// matches those elements, e.g. `${styles} { &.key { ... } }` in global styles
pub(super) fn raw_hashed_cx_key_error(
    keys: &HashedCxKeys,
    hashed_owners: &[(&str, &str)],
    css_rules: &[String],
    global_rules: &[usize],
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
    for (index, rule) in css_rules.iter().enumerate() {
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
        // global styles like `html { &.key { ... } }` or `${Box} { &.key { ... } }` can be any
        // element
        let owner = if global_rules.contains(&index) {
            None
        } else {
            element_rule_owner(&stylesheet.statements, &generated_prefix)
        };
        let is_element_rule = owner.is_some();
        let own_classes = if is_element_rule {
            class_rule_element_classes(&stylesheet.statements)
        } else {
            Vec::new()
        };
        let mut collector = ClassCollector::default();
        collector.statements(&stylesheet.statements);
        for (name, _, span) in candidates {
            let is_hashing_owner = owner.is_some_and(|owner| {
                hashed_owners
                    .iter()
                    .any(|(class, key)| *class == owner && key == name)
            });
            let is_own_class = |class: &SelectorClass<'_>| {
                own_classes.iter().any(|own| {
                    !own.mixed && own.start == class.span.start && own.end == class.span.end
                })
            };
            let Some(raw) = collector
                .classes
                .iter()
                .find(|class| class.name == *name && (is_hashing_owner || !is_own_class(class)))
            else {
                continue;
            };
            // The generated class of the element rule is not written in the source, except when
            // other styles select the element with it, like `${styles} { &.key { ... } }`
            let chain = if is_element_rule && !(is_hashing_owner && is_own_class(raw)) {
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

/// The element class of the file the statements are the generated rules of, e.g. `vhash-1-Box`
/// for `.vhash-1-Box { ... }`, also inside `@layer` blocks
fn element_rule_owner<'s>(
    statements: &'s [Statement<'s>],
    generated_prefix: &str,
) -> Option<&'s str> {
    let mut owner = None;
    for statement in statements {
        let class = match statement {
            Statement::QualifiedRule(rule) => generated_class(&rule.selector, generated_prefix)?,
            Statement::AtRule(rule) if rule.name.name.eq_ignore_ascii_case("layer") => {
                element_rule_owner(&rule.block.as_ref()?.statements, generated_prefix)?
            }
            _ => return None,
        };
        if owner.is_some_and(|owner| owner != class) {
            return None;
        }
        owner = Some(class);
    }
    owner
}

/// The class of a selector list that is a single generated class of the file
fn generated_class<'s>(list: &'s SelectorList<'s>, generated_prefix: &str) -> Option<&'s str> {
    let [selector] = list.selectors.as_slice() else {
        return None;
    };
    let [ComplexSelectorChild::CompoundSelector(compound)] = selector.children.as_slice() else {
        return None;
    };
    match compound.children.as_slice() {
        [SimpleSelector::Class(class)] => match &class.name {
            InterpolableIdent::Literal(ident) if ident.name.starts_with(generated_prefix) => {
                Some(ident.name)
            }
            _ => None,
        },
        _ => None,
    }
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

    /// `vh-1-Card` is a css reference whose own `&.active` rules a cx prop renamed
    fn check(rule: &str, global_rules: &[usize]) -> bool {
        let keys = HashedCxKeys {
            keys: vec![("active".to_owned(), Span::new(0, 0))],
        };
        let hashed_owners = [("vh-1-Card", "active")];
        raw_hashed_cx_key_error(
            &keys,
            &hashed_owners,
            &[rule.to_owned()],
            global_rules,
            "vh",
            "file.tsx",
            "",
        )
        .is_some()
    }

    fn fails(rule: &str) -> bool {
        check(rule, &[])
    }

    #[test]
    fn fails_for_modifiers_of_element_classes_in_global_styles() {
        assert_eq!(
            [
                check(".vh-1-Item { &.active { color: red; } }", &[0]),
                check(".vh-1-Item.active { color: red; }", &[0]),
                check(".vh2-1-Imported { &.active { color: red; } }", &[0]),
            ],
            [true; 3]
        );
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
                fails("@layer theme { .vh-1-Card { &.active { color: red; } } }"),
                fails(".vh-1-Card { &.active { color: red; } }"),
            ],
            [true; 22]
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
