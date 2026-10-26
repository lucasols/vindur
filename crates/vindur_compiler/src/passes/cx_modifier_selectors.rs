use oxc_css_parser::{
    Allocator,
    ast::{
        AtRule, AtRulePrelude, ComplexSelector, ComplexSelectorChild, CompoundSelector,
        InterpolableIdent, PseudoClassSelector, PseudoClassSelectorArgKind, ScopePrelude,
        SelectorList, SimpleSelector, Statement,
    },
};

use super::css::top_level_layer;
use super::css_syntax::{CssError, parse_style_block};

/// What the parsed CSS is
#[derive(Clone, Copy)]
pub(super) enum ModifierCss {
    /// The contents of the element style block, where `&` is the element
    Block,
    /// Generated rules of the element class, e.g. `.cls { ... }` or `@layer a { .cls { ... } }`
    ClassRule,
}

/// Where the selectors of a rule are matched
#[derive(Clone, Copy, PartialEq, Eq)]
enum Context {
    /// Outside the element class rule
    Outer,
    /// `&` is the element
    Element,
    /// `&` is a descendant, sibling or ancestor of the element
    Other,
}

/// A class selector that applies to the element itself, `start..end` is the class name
struct ElementClass {
    start: usize,
    end: usize,
    name: String,
}

/// The classes used in selectors of the element itself, e.g. `name` in `&.name`, `&:not(.name)`
/// or `&.other.name`
pub(super) fn element_class_names(css: &str, kind: ModifierCss) -> Result<Vec<String>, CssError> {
    Ok(element_classes(css, kind)?
        .into_iter()
        .map(|class| class.name)
        .collect())
}

/// Renames the classes of the element selectors with the `(original, hashed, should_rewrite)`
/// mappings, classes of other elements (e.g. `& .name`) are kept as is
pub(super) fn rewrite_modifiers(
    css: &str,
    kind: ModifierCss,
    mappings: &[(String, String, bool)],
) -> Result<String, CssError> {
    let mut result = String::with_capacity(css.len());
    let mut last = 0;
    for class in element_classes(css, kind)? {
        let Some((_, hashed, _)) = mappings
            .iter()
            .find(|(original, _, should_rewrite)| *should_rewrite && *original == class.name)
        else {
            continue;
        };
        result.push_str(&css[last..class.start]);
        result.push_str(hashed);
        last = class.end;
    }
    result.push_str(&css[last..]);
    Ok(result)
}

fn element_classes(css: &str, kind: ModifierCss) -> Result<Vec<ElementClass>, CssError> {
    let allocator = Allocator::default();
    let stylesheet = parse_style_block(&allocator, css)?;
    let mut collector = ElementClassCollector {
        classes: Vec::new(),
        scope_root_is_element: false,
        nesting_is_element: true,
    };
    match kind {
        ModifierCss::Block => {
            for statement in &stylesheet.statements {
                match statement {
                    // `layer()` blocks are unwrapped into the element class rule
                    Statement::QualifiedRule(rule) if top_level_layer(css, rule).is_some() => {
                        collector.statements(&rule.block.statements, Context::Element);
                    }
                    _ => collector.statements(std::slice::from_ref(statement), Context::Element),
                }
            }
        }
        ModifierCss::ClassRule => collector.statements(&stylesheet.statements, Context::Outer),
    }
    collector.classes.sort_by_key(|class| class.start);
    Ok(collector.classes)
}

struct ElementClassCollector {
    classes: Vec<ElementClass>,
    /// In a `@scope` whose root is the element, so `:scope` is the element too
    scope_root_is_element: bool,
    /// `&` is the element, false in the selectors of rules nested in other elements
    nesting_is_element: bool,
}

impl ElementClassCollector {
    fn statements(&mut self, statements: &[Statement<'_>], context: Context) {
        for statement in statements {
            match statement {
                Statement::QualifiedRule(rule) => {
                    let nested = match context {
                        Context::Outer => Context::Element,
                        Context::Element => self.selector_list(&rule.selector),
                        Context::Other => {
                            self.other_selector_list(&rule.selector);
                            Context::Other
                        }
                    };
                    self.statements(&rule.block.statements, nested);
                }
                Statement::AtRule(rule) => {
                    let (nested, scope_root_is_element) = self.at_rule(rule, context);
                    if let Some(block) = &rule.block {
                        let outer_scope_root = std::mem::replace(
                            &mut self.scope_root_is_element,
                            scope_root_is_element,
                        );
                        self.statements(&block.statements, nested);
                        self.scope_root_is_element = outer_scope_root;
                    }
                }
                _ => {}
            }
        }
    }

    /// Returns the context of the at-rule body and if its scope root is the element. Grouping
    /// rules like `@media` keep both. In a `@scope` body `&` and `:scope` are the scope root, so
    /// they're still the element only when every start selector is, e.g. `@scope (&.a)`. Without
    /// a start selector, e.g. `@scope to (.x)`, the root is the parent of the stylesheet owner
    fn at_rule(&mut self, rule: &AtRule<'_>, context: Context) -> (Context, bool) {
        let is_scope = rule.name.name.eq_ignore_ascii_case("scope");
        let prelude = match &rule.prelude {
            Some(AtRulePrelude::Scope(prelude)) => Some(prelude.as_ref()),
            _ if is_scope => None,
            _ => return (context, self.scope_root_is_element),
        };
        let (start, end) = match prelude {
            Some(ScopePrelude::StartOnly(start)) => (Some(start), None),
            Some(ScopePrelude::Both(both)) => (Some(&both.start), Some(&both.end)),
            Some(ScopePrelude::EndOnly(end)) => (None, Some(end)),
            None => (None, None),
        };
        let body = match (context, start.map(|start| &start.selector)) {
            (Context::Outer, _) => Context::Outer,
            (Context::Element, Some(Some(list))) => self.selector_list(list),
            _ => Context::Other,
        };
        let scope_root_is_element = body == Context::Element;
        // `&` and `:scope` in the end selectors are the scope root, other compounds are its
        // descendants
        if scope_root_is_element && let Some(Some(list)) = end.map(|end| &end.selector) {
            let outer_scope_root = std::mem::replace(&mut self.scope_root_is_element, true);
            for selector in &list.selectors {
                self.selector(selector, false);
            }
            self.scope_root_is_element = outer_scope_root;
        }
        (body, scope_root_is_element)
    }

    /// Collects the element classes of a rule nested in the element, the rule block may still
    /// match the element when the subject of any selector is, e.g. `&:hover, & .child`
    fn selector_list(&mut self, list: &SelectorList<'_>) -> Context {
        let mut is_element = false;
        for selector in &list.selectors {
            is_element |= self.selector(selector, false);
        }
        if is_element {
            Context::Element
        } else {
            Context::Other
        }
    }

    /// In rules nested in other elements only `:scope` can still be the element, e.g.
    /// `:scope.active &` in `@scope (&) { & .child { ... } }`
    fn other_selector_list(&mut self, list: &SelectorList<'_>) {
        if !self.scope_root_is_element {
            return;
        }
        let outer_nesting = std::mem::replace(&mut self.nesting_is_element, false);
        for selector in &list.selectors {
            self.selector(selector, false);
        }
        self.nesting_is_element = outer_nesting;
    }

    /// Collects the classes of the compounds that are the element, returns if the subject is
    fn selector(&mut self, selector: &ComplexSelector<'_>, subject_is_element: bool) -> bool {
        let compounds = compounds(selector);
        let mut subject = false;
        for (index, compound) in compounds.iter().enumerate() {
            let is_subject = index + 1 == compounds.len();
            let is_element =
                (is_subject && subject_is_element) || self.is_element_compound(compound);
            self.compound(compound, is_element);
            if is_subject {
                subject = is_element;
            }
        }
        subject
    }

    fn compound(&mut self, compound: &CompoundSelector<'_>, is_element: bool) {
        for simple in &compound.children {
            match simple {
                SimpleSelector::Class(class) if is_element => {
                    if let InterpolableIdent::Literal(ident) = &class.name {
                        self.classes.push(ElementClass {
                            start: ident.span.start,
                            end: ident.span.end,
                            name: ident.name.to_owned(),
                        });
                    }
                }
                SimpleSelector::PseudoClass(pseudo) => {
                    // `&` compounds can be nested in any selector argument
                    let subject_is_element = is_element && matches_element(pseudo);
                    for argument in pseudo_class_selectors(pseudo) {
                        match argument {
                            SelectorArgument::Complex(selector) => {
                                self.selector(selector, subject_is_element);
                            }
                            SelectorArgument::Compound(compound) => self.compound(
                                compound,
                                subject_is_element || self.is_element_compound(compound),
                            ),
                        }
                    }
                }
                _ => {}
            }
        }
    }

    fn is_element_compound(&self, compound: &CompoundSelector<'_>) -> bool {
        is_element_compound(
            compound,
            ElementRefs {
                nesting: self.nesting_is_element,
                scope: self.scope_root_is_element,
            },
        )
    }
}

/// Which of `&` and `:scope` are the element
#[derive(Clone, Copy)]
struct ElementRefs {
    nesting: bool,
    scope: bool,
}

enum SelectorArgument<'s, 'a> {
    Complex(&'s ComplexSelector<'a>),
    Compound(&'s CompoundSelector<'a>),
}

fn pseudo_class_selectors<'s, 'a>(
    pseudo: &'s PseudoClassSelector<'a>,
) -> Vec<SelectorArgument<'s, 'a>> {
    match pseudo.arg.as_ref().map(|arg| &arg.kind) {
        Some(PseudoClassSelectorArgKind::SelectorList(list)) => list
            .selectors
            .iter()
            .map(SelectorArgument::Complex)
            .collect(),
        Some(PseudoClassSelectorArgKind::RelativeSelectorList(list)) => list
            .selectors
            .iter()
            .map(|selector| SelectorArgument::Complex(&selector.complex_selector))
            .collect(),
        Some(PseudoClassSelectorArgKind::CompoundSelectorList(list)) => list
            .selectors
            .iter()
            .map(SelectorArgument::Compound)
            .collect(),
        Some(PseudoClassSelectorArgKind::Nth(nth)) => nth
            .matcher
            .iter()
            .filter_map(|matcher| matcher.selector.as_ref())
            .flat_map(|list| list.selectors.iter().map(SelectorArgument::Complex))
            .collect(),
        _ => Vec::new(),
    }
}

/// `:not()`, `:is()`, `:where()` and `:nth-child(of)` match the element against their
/// selectors, so the subject of each one is the element. `:has()` matches other elements
fn matches_element(pseudo: &PseudoClassSelector<'_>) -> bool {
    pseudo_class_name_is(pseudo, &["not"]) || selects_element(pseudo)
}

/// The pseudo-classes that only match elements matching their selectors
fn selects_element(pseudo: &PseudoClassSelector<'_>) -> bool {
    pseudo_class_name_is(
        pseudo,
        &[
            "is",
            "where",
            "matches",
            "any",
            "-webkit-any",
            "-moz-any",
            "nth-child",
            "nth-last-child",
        ],
    )
}

fn pseudo_class_name_is(pseudo: &PseudoClassSelector<'_>, names: &[&str]) -> bool {
    let InterpolableIdent::Literal(name) = &pseudo.name else {
        return false;
    };
    names
        .iter()
        .any(|matching| name.name.eq_ignore_ascii_case(matching))
}

/// A compound with `&` or `:scope` when they're the element, or one that only matches what its
/// `&` arguments match, e.g. `:is(&.a)`
fn is_element_compound(compound: &CompoundSelector<'_>, refs: ElementRefs) -> bool {
    compound.children.iter().any(|simple| match simple {
        SimpleSelector::Nesting(_) => refs.nesting,
        SimpleSelector::PseudoClass(pseudo)
            if refs.scope && pseudo_class_name_is(pseudo, &["scope"]) =>
        {
            true
        }
        SimpleSelector::PseudoClass(pseudo) if selects_element(pseudo) => {
            let arguments = pseudo_class_selectors(pseudo);
            !arguments.is_empty()
                && arguments.iter().all(|argument| match argument {
                    SelectorArgument::Complex(selector) => compounds(selector)
                        .last()
                        .is_some_and(|subject| is_element_compound(subject, refs)),
                    SelectorArgument::Compound(compound) => is_element_compound(compound, refs),
                })
        }
        _ => false,
    })
}

fn compounds<'s, 'a>(selector: &'s ComplexSelector<'a>) -> Vec<&'s CompoundSelector<'a>> {
    selector
        .children
        .iter()
        .filter_map(|child| match child {
            ComplexSelectorChild::CompoundSelector(compound) => Some(compound),
            ComplexSelectorChild::Combinator(_) => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{ModifierCss, element_class_names, rewrite_modifiers};

    fn rewrite(css: &str, kind: ModifierCss) -> String {
        let mappings = [
            ("active".to_owned(), "h-active".to_owned(), true),
            ("disabled".to_owned(), "h-disabled".to_owned(), true),
        ];
        match rewrite_modifiers(css, kind, &mappings) {
            Ok(css) => css,
            Err(error) => panic!("{}", error.message),
        }
    }

    fn block(css: &str) -> String {
        rewrite(css, ModifierCss::Block)
    }

    #[test]
    fn rewrites_classes_of_the_element() {
        assert_eq!(
            [
                block("&.active { color: red; }"),
                block("&.active.disabled { color: red; }"),
                block("&.disabled, &.active:hover { color: red; }"),
                block(".parent &.active { color: red; }"),
                block("&:not(.active) { color: red; }"),
                block("&:is(.active, .disabled):where(.x .active) { color: red; }"),
                block("@media (min-width: 1px) { &.active { color: red; } }"),
                block("&:hover { &.active { color: red; } }"),
                block("&:hover, & .child { &.active { color: red; } }"),
                block(":where(&.active) { &.disabled { color: red; } }"),
                block(".x:not(&.active) { color: red; }"),
                block("&:nth-child(1 of .active):nth-last-child(2 of &.disabled) { color: red; }"),
                block("@scope (&.active) { &.disabled { color: red; } }"),
                block("@scope (&) { :scope.active { color: red; } }"),
                block("@scope (&) { :scope { &.active { color: red; } } }"),
                block("@scope (&) to (&.active > *) { .child { color: red; } }"),
                block("@scope (&) { & .child { :scope.active & { color: red; } } }"),
            ],
            [
                "&.h-active { color: red; }",
                "&.h-active.h-disabled { color: red; }",
                "&.h-disabled, &.h-active:hover { color: red; }",
                ".parent &.h-active { color: red; }",
                "&:not(.h-active) { color: red; }",
                "&:is(.h-active, .h-disabled):where(.x .h-active) { color: red; }",
                "@media (min-width: 1px) { &.h-active { color: red; } }",
                "&:hover { &.h-active { color: red; } }",
                "&:hover, & .child { &.h-active { color: red; } }",
                ":where(&.h-active) { &.h-disabled { color: red; } }",
                ".x:not(&.h-active) { color: red; }",
                "&:nth-child(1 of .h-active):nth-last-child(2 of &.h-disabled) { color: red; }",
                "@scope (&.h-active) { &.h-disabled { color: red; } }",
                "@scope (&) { :scope.h-active { color: red; } }",
                "@scope (&) { :scope { &.h-active { color: red; } } }",
                "@scope (&) to (&.h-active > *) { .child { color: red; } }",
                "@scope (&) { & .child { :scope.h-active & { color: red; } } }",
            ]
        );
    }

    #[test]
    fn keeps_classes_of_other_elements() {
        for css in [
            "& .active { color: red; }",
            "& + .active { color: red; }",
            ".active { color: red; }",
            "&.active-extra { color: red; }",
            "&:has(.active) { color: red; }",
            "& .child { &.active { color: red; } }",
            ":where(&, .x) { &.active { color: red; } }",
            ":not(&) { &.active { color: red; } }",
            "&:nth-of-type(1) .active { color: red; }",
            "@scope (.x) { &.active { color: red; } }",
            "@scope (&) to (.active) { color: red; }",
            "@scope (.x) to (&.active) { color: red; }",
            "@scope (.x) { :scope.active { color: red; } }",
            ":scope.active { color: red; }",
            "& .child { @scope (&) { :scope.active { color: red; } } }",
            "@scope to (.x) { &.active { color: red; } }",
            "@scope { :scope.active { color: red; } }",
            "@scope to (:scope.active > *) { color: red; }",
            "content: \"&.active\"; /* &.active */",
            "---x: &.active;",
        ] {
            assert_eq!(block(css), css);
        }
    }

    #[test]
    fn rewrites_generated_class_rules() {
        assert_eq!(
            rewrite(
                "@layer base {\n  .cls {\n  &.active { color: red; }\n}\n}",
                ModifierCss::ClassRule
            ),
            "@layer base {\n  .cls {\n  &.h-active { color: red; }\n}\n}"
        );
    }

    #[test]
    fn lists_element_class_names() {
        let names = |css: &str| element_class_names(css, ModifierCss::Block).ok();
        assert_eq!(
            [
                names("&:not(.active) { opacity: 0.5; } & .child { color: red; }"),
                names("& .active { opacity: 0.5; }"),
            ],
            [Some(vec!["active".to_owned()]), Some(Vec::new())]
        );
    }
}
