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
        result.push_str(&escape_identifier(hashed));
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
}

impl ElementClassCollector {
    fn statements(&mut self, statements: &[Statement<'_>], context: Context) {
        for statement in statements {
            match statement {
                Statement::QualifiedRule(rule) => {
                    let nested = match context {
                        Context::Outer => Context::Element,
                        Context::Element => self.selector_list(&rule.selector),
                        Context::Other => Context::Other,
                    };
                    self.statements(&rule.block.statements, nested);
                }
                Statement::AtRule(rule) => {
                    let nested = self.at_rule(rule, context);
                    if let Some(block) = &rule.block {
                        self.statements(&block.statements, nested);
                    }
                }
                _ => {}
            }
        }
    }

    /// Grouping rules like `@media` keep the context. In a `@scope` body `&` is the scope root,
    /// so it's still the element only when every start selector is, e.g. `@scope (&.a)`
    fn at_rule(&mut self, rule: &AtRule<'_>, context: Context) -> Context {
        let Some(AtRulePrelude::Scope(prelude)) = &rule.prelude else {
            return context;
        };
        let start = match prelude.as_ref() {
            ScopePrelude::StartOnly(start) => start,
            ScopePrelude::Both(both) => &both.start,
            ScopePrelude::EndOnly(_) => return context,
        };
        match (context, &start.selector) {
            (Context::Outer, _) => Context::Outer,
            (Context::Element, Some(list)) => self.selector_list(list),
            _ => Context::Other,
        }
    }

    /// Collects the element classes of a rule nested in the element, the rule block is still
    /// the element when the subject of every selector is, e.g. `&:hover, &.a, :where(&.b)`
    fn selector_list(&mut self, list: &SelectorList<'_>) -> Context {
        let mut is_element = !list.selectors.is_empty();
        for selector in &list.selectors {
            is_element &= self.selector(selector, false);
        }
        if is_element {
            Context::Element
        } else {
            Context::Other
        }
    }

    /// Collects the classes of the compounds that are the element, returns if the subject is
    fn selector(&mut self, selector: &ComplexSelector<'_>, subject_is_element: bool) -> bool {
        let compounds = compounds(selector);
        let mut subject = false;
        for (index, compound) in compounds.iter().enumerate() {
            let is_subject = index + 1 == compounds.len();
            let is_element = (is_subject && subject_is_element) || is_element_compound(compound);
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
                                subject_is_element || is_element_compound(compound),
                            ),
                        }
                    }
                }
                _ => {}
            }
        }
    }
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

/// A compound with `&`, or one that only matches what its `&` arguments match, e.g. `:is(&.a)`
fn is_element_compound(compound: &CompoundSelector<'_>) -> bool {
    compound.children.iter().any(|simple| match simple {
        SimpleSelector::Nesting(_) => true,
        SimpleSelector::PseudoClass(pseudo) if selects_element(pseudo) => {
            let arguments = pseudo_class_selectors(pseudo);
            !arguments.is_empty()
                && arguments.iter().all(|argument| match argument {
                    SelectorArgument::Complex(selector) => compounds(selector)
                        .last()
                        .is_some_and(|subject| is_element_compound(subject)),
                    SelectorArgument::Compound(compound) => is_element_compound(compound),
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

/// Serializes a class name as a CSS identifier, like `CSS.escape`
fn escape_identifier(name: &str) -> String {
    let mut escaped = String::with_capacity(name.len());
    let first = name.chars().next();
    for (index, character) in name.chars().enumerate() {
        let starts_with_digit =
            character.is_ascii_digit() && (index == 0 || (index == 1 && first == Some('-')));
        if character == '\0' {
            escaped.push('\u{FFFD}');
        } else if character.is_control() || starts_with_digit {
            escaped.push_str(&format!("\\{:x} ", u32::from(character)));
        } else if character.is_ascii_alphanumeric()
            || character == '-'
            || character == '_'
            || !character.is_ascii()
        {
            if index == 0 && character == '-' && name.len() == 1 {
                escaped.push('\\');
            }
            escaped.push(character);
        } else {
            escaped.push('\\');
            escaped.push(character);
        }
    }
    escaped
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
                block(":where(&.active) { &.disabled { color: red; } }"),
                block(".x:not(&.active) { color: red; }"),
                block("&:nth-child(1 of .active):nth-last-child(2 of &.disabled) { color: red; }"),
                block("@scope (&.active) { &.disabled { color: red; } }"),
                block("@scope to (.x) { &.active { color: red; } }"),
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
                ":where(&.h-active) { &.h-disabled { color: red; } }",
                ".x:not(&.h-active) { color: red; }",
                "&:nth-child(1 of .h-active):nth-last-child(2 of &.h-disabled) { color: red; }",
                "@scope (&.h-active) { &.h-disabled { color: red; } }",
                "@scope to (.x) { &.h-active { color: red; } }",
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
            "&:hover, & .child { &.active { color: red; } }",
            ":where(&, .x) { &.active { color: red; } }",
            ":not(&) { &.active { color: red; } }",
            "&:nth-of-type(1) .active { color: red; }",
            "@scope (.x) { &.active { color: red; } }",
            "@scope (&) to (.active) { color: red; }",
            "content: \"&.active\"; /* &.active */",
            "---x: &.active;",
        ] {
            assert_eq!(block(css), css);
        }
    }

    #[test]
    fn escapes_hashed_names() {
        let mappings = [("is:on".to_owned(), "h-1-is:on".to_owned(), true)];
        let rewrite = |css: &str| {
            rewrite_modifiers(css, ModifierCss::Block, &mappings).map_err(|error| error.message)
        };
        assert_eq!(
            rewrite("&.is\\:on, &:focus { color: red; }"),
            Ok("&.h-1-is\\:on, &:focus { color: red; }".to_owned())
        );
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
