use oxc_css_parser::{
    Allocator,
    ast::{
        ComplexSelector, ComplexSelectorChild, CompoundSelector, InterpolableIdent,
        PseudoClassSelector, PseudoClassSelectorArgKind, SelectorList, SimpleSelector, Statement,
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
                    if let Some(block) = &rule.block {
                        self.statements(&block.statements, context);
                    }
                }
                _ => {}
            }
        }
    }

    /// Collects the element classes of a rule nested in the element, the rule block is still
    /// the element when every selector ends with a `&` compound, e.g. `&:hover, &.a`
    fn selector_list(&mut self, list: &SelectorList<'_>) -> Context {
        let mut is_element = !list.selectors.is_empty();
        for selector in &list.selectors {
            let compounds = compounds(selector);
            for compound in &compounds {
                if has_nesting(compound) {
                    self.compound(compound);
                }
            }
            is_element &= compounds
                .last()
                .is_some_and(|compound| has_nesting(compound));
        }
        if is_element {
            Context::Element
        } else {
            Context::Other
        }
    }

    fn compound(&mut self, compound: &CompoundSelector<'_>) {
        for simple in &compound.children {
            match simple {
                SimpleSelector::Class(class) => {
                    if let InterpolableIdent::Literal(ident) = &class.name {
                        self.classes.push(ElementClass {
                            start: ident.span.start,
                            end: ident.span.end,
                            name: ident.name.to_owned(),
                        });
                    }
                }
                SimpleSelector::PseudoClass(pseudo) => self.pseudo_class(pseudo),
                _ => {}
            }
        }
    }

    /// `:not()`, `:is()` and `:where()` match the element against their selectors, so the
    /// subject compound of each one is the element. `:has()` matches other elements
    fn pseudo_class(&mut self, pseudo: &PseudoClassSelector<'_>) {
        let InterpolableIdent::Literal(name) = &pseudo.name else {
            return;
        };
        if !["not", "is", "where"]
            .iter()
            .any(|matching| name.name.eq_ignore_ascii_case(matching))
        {
            return;
        }
        match pseudo.arg.as_ref().map(|arg| &arg.kind) {
            Some(PseudoClassSelectorArgKind::SelectorList(list)) => {
                for selector in &list.selectors {
                    if let Some(subject) = compounds(selector).last() {
                        self.compound(subject);
                    }
                }
            }
            Some(PseudoClassSelectorArgKind::CompoundSelectorList(list)) => {
                for compound in &list.selectors {
                    self.compound(compound);
                }
            }
            _ => {}
        }
    }
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

fn has_nesting(compound: &CompoundSelector<'_>) -> bool {
    compound
        .children
        .iter()
        .any(|simple| matches!(simple, SimpleSelector::Nesting(_)))
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
