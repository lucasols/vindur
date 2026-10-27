use std::ops::Range;

use oxc_css_parser::{
    Allocator,
    ast::{
        AtRule, AtRulePrelude, ComplexSelector, ComplexSelectorChild, CompoundSelector,
        InterpolableIdent, PseudoClassSelector, PseudoClassSelectorArgKind, ScopePrelude,
        SelectorList, SimpleSelector, Statement, TypeSelector,
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
    /// In a rule nested in the element, see `Subject` for what its `&` is
    Nested(Subject),
}

/// What a compound selector or `&` is, ordered so a compound with several of them is the greatest,
/// e.g. `&:is(&, .x)` is the element
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Subject {
    /// A descendant, sibling or ancestor of the element
    Other,
    /// The element in some selectors and another element in others, e.g. `:where(&, .x)` or the
    /// `&` of a rule nested in `&:hover, & .child`
    Mixed,
    /// The element
    Element,
}

/// A class selector that may apply to the element itself, `start..end` is the class name
pub(super) struct ElementClass {
    pub start: usize,
    pub end: usize,
    pub name: String,
    /// Also applies to other elements, so it can't be hashed, e.g. `&.name` in `&:hover, & .child`
    pub mixed: bool,
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
/// mappings, classes of other elements (e.g. `& .name`) are kept as is. Fails for classes of rules
/// that match both the element and other elements, renaming them would break the other elements
pub(super) fn rewrite_modifiers(
    css: &str,
    kind: ModifierCss,
    mappings: &[(String, String, bool)],
) -> Result<String, CssError> {
    if !rewrites_any(mappings) {
        return Ok(css.to_owned());
    }
    rewrite_classes(css, &element_classes(css, kind)?, mappings, |name| {
        format!(
            "cx prop class \"{name}\" can't be hashed in a rule that matches both the element and other elements, like \"&.{name}\" nested in \"&:hover, & .child\" or \":where(&, .x)\". Split the selectors into separate rules or use a $-prefixed class (e.g. ${name})."
        )
    })
}

/// Renames the `classes` of `css` with the `(original, hashed, should_rewrite)` mappings. Fails
/// with the `mixed_error` message of the class name for renamed classes of rules that match both
/// the element and other elements
pub(super) fn rewrite_classes(
    css: &str,
    classes: &[ElementClass],
    mappings: &[(String, String, bool)],
    mixed_error: impl Fn(&str) -> String,
) -> Result<String, CssError> {
    let mut result = String::with_capacity(css.len());
    let mut last = 0;
    for class in classes {
        let Some((_, hashed, _)) = mappings
            .iter()
            .find(|(original, _, should_rewrite)| *should_rewrite && *original == class.name)
        else {
            continue;
        };
        if class.mixed {
            return Err(CssError::new(
                mixed_error(&class.name),
                class.start,
                class.end,
            ));
        }
        result.push_str(&css[last..class.start]);
        result.push_str(hashed);
        last = class.end;
    }
    result.push_str(&css[last..]);
    Ok(result)
}

/// If any of the `(original, hashed, should_rewrite)` mappings renames a class
pub(super) fn rewrites_any(mappings: &[(String, String, bool)]) -> bool {
    mappings
        .iter()
        .any(|(_, _, should_rewrite)| *should_rewrite)
}

/// The class selectors that may apply to the element itself, sorted by position
pub(super) fn element_classes(css: &str, kind: ModifierCss) -> Result<Vec<ElementClass>, CssError> {
    Ok(collect_classes(css, kind, None)?.classes)
}

/// The class selectors of a style block
pub(super) struct StyleBlockClasses {
    /// The classes that may apply to the element itself, sorted by position
    pub element: Vec<ElementClass>,
    /// The class names of the selectors of other elements, e.g. `name` in `& .name`
    pub other: Vec<Range<usize>>,
}

pub(super) fn style_block_classes(css: &str) -> Result<StyleBlockClasses, CssError> {
    let collector = collect_classes(css, ModifierCss::Block, Some(Vec::new()))?;
    Ok(StyleBlockClasses {
        element: collector.classes,
        other: collector.other_classes.unwrap_or_default(),
    })
}

fn collect_classes(
    css: &str,
    kind: ModifierCss,
    other_classes: Option<Vec<Range<usize>>>,
) -> Result<ElementClassCollector<'static>, CssError> {
    let allocator = Allocator::default();
    let stylesheet = parse_style_block(&allocator, css)?;
    let mut collector = ElementClassCollector {
        classes: Vec::new(),
        other_classes,
        reference: None,
        scope_root: Subject::Other,
        nesting: Subject::Element,
    };
    match kind {
        ModifierCss::Block => {
            for statement in &stylesheet.statements {
                match statement {
                    // `layer()` blocks are unwrapped into the element class rule
                    Statement::QualifiedRule(rule) if top_level_layer(css, rule).is_some() => {
                        collector.statements(&rule.block.statements, ELEMENT);
                    }
                    _ => collector.statements(std::slice::from_ref(statement), ELEMENT),
                }
            }
        }
        ModifierCss::ClassRule => collector.statements(&stylesheet.statements, Context::Outer),
    }
    collector.classes.sort_by_key(|class| class.start);
    Ok(collector)
}

/// The classes that may apply to a styled component selected through a reference to it in the
/// statements, e.g. `active` in `.item.active &`, `:is(.item).active &` or
/// `& .item { &.active { ... } }`, sorted by position. The component is referenced by its
/// `classes` and its forward reference `placeholders`
pub(super) fn referenced_classes(
    statements: &[Statement<'_>],
    classes: &[String],
    placeholders: &[String],
) -> Vec<ElementClass> {
    let mut collector = ElementClassCollector {
        classes: Vec::new(),
        other_classes: None,
        reference: Some(ComponentReference {
            classes,
            placeholders,
        }),
        scope_root: Subject::Other,
        nesting: Subject::Other,
    };
    collector.statements(statements, OTHER);
    collector.classes.sort_by_key(|class| class.start);
    collector.classes
}

const ELEMENT: Context = Context::Nested(Subject::Element);
const OTHER: Context = Context::Nested(Subject::Other);

struct ElementClassCollector<'r> {
    classes: Vec<ElementClass>,
    /// Also collects the classes of other elements when set
    other_classes: Option<Vec<Range<usize>>>,
    /// The referenced styled component, which is the element instead of `&` when set
    reference: Option<ComponentReference<'r>>,
    /// What the root of the enclosing `@scope` is, `:scope` is the element when it is
    scope_root: Subject,
    /// What `&` is in the selectors being walked
    nesting: Subject,
}

impl ElementClassCollector<'_> {
    /// If the selectors of other elements are walked too, as they can contain the element
    fn walks_other_elements(&self) -> bool {
        self.other_classes.is_some() || self.reference.is_some()
    }

    fn statements(&mut self, statements: &[Statement<'_>], context: Context) {
        for statement in statements {
            match statement {
                Statement::QualifiedRule(rule) => {
                    let nested = match context {
                        Context::Outer => ELEMENT,
                        Context::Nested(nesting) => self.selector_list(&rule.selector, nesting),
                    };
                    self.statements(&rule.block.statements, nested);
                }
                Statement::AtRule(rule) => {
                    let (nested, scope_root) = self.at_rule(rule, context);
                    if let Some(block) = &rule.block {
                        let outer_scope_root = std::mem::replace(&mut self.scope_root, scope_root);
                        self.statements(&block.statements, nested);
                        self.scope_root = outer_scope_root;
                    }
                }
                _ => {}
            }
        }
    }

    /// Returns the context of the at-rule body and what its scope root is. Grouping rules like
    /// `@media` keep both. In a `@scope` body `&` and `:scope` are the scope root, the subjects
    /// of its start selectors, e.g. the element for `@scope (&.a)` and mixed for
    /// `@scope (&, & .x)`. Without a start selector, e.g. `@scope to (.x)`, the root is the parent
    /// of the stylesheet owner. In the start selectors of a `@scope` nested in other elements only
    /// `:scope` can still be the element, e.g. `@scope (:scope.active > &)` in
    /// `@scope (&) { & .child { ... } }`, and the body is the element again when it's the subject,
    /// e.g. `@scope (:scope.active)`
    fn at_rule(&mut self, rule: &AtRule<'_>, context: Context) -> (Context, Subject) {
        let is_scope = rule.name.name.eq_ignore_ascii_case("scope");
        let prelude = match &rule.prelude {
            Some(AtRulePrelude::Scope(prelude)) => Some(prelude.as_ref()),
            _ if is_scope => None,
            _ => return (context, self.scope_root),
        };
        let (start, end) = match prelude {
            Some(ScopePrelude::StartOnly(start)) => (Some(start), None),
            Some(ScopePrelude::Both(both)) => (Some(&both.start), Some(&both.end)),
            Some(ScopePrelude::EndOnly(end)) => (None, Some(end)),
            None => (None, None),
        };
        let body = match (context, start.map(|start| &start.selector)) {
            (Context::Outer, _) => Context::Outer,
            (Context::Nested(nesting), Some(Some(list))) => self.selector_list(list, nesting),
            _ => OTHER,
        };
        let scope_root = match body {
            Context::Nested(subject) => subject,
            Context::Outer => Subject::Other,
        };
        // `&` and `:scope` in the end selectors are the scope root, other compounds are its
        // descendants
        if (scope_root != Subject::Other || self.walks_other_elements())
            && let Some(Some(list)) = end.map(|end| &end.selector)
        {
            let outer_scope_root = std::mem::replace(&mut self.scope_root, scope_root);
            let outer_nesting = std::mem::replace(&mut self.nesting, scope_root);
            for selector in &list.selectors {
                self.selector(selector, Subject::Other);
            }
            self.scope_root = outer_scope_root;
            self.nesting = outer_nesting;
        }
        (body, scope_root)
    }

    /// Collects the element classes of a rule nested in a rule whose `&` is `nesting`. The rule
    /// block is the element when the subject of every selector is, and mixed when only some are,
    /// e.g. `&:hover, & .child`. In rules nested in other elements only `:scope` can still be the
    /// element, e.g. `:scope.active &` in `@scope (&) { & .child { ... } }` or `:scope:has(&)`
    fn selector_list(&mut self, list: &SelectorList<'_>, nesting: Subject) -> Context {
        if nesting == Subject::Other
            && self.scope_root == Subject::Other
            && !self.walks_other_elements()
        {
            return OTHER;
        }
        let outer_nesting = std::mem::replace(&mut self.nesting, nesting);
        let subjects = list
            .selectors
            .iter()
            .map(|selector| self.selector(selector, Subject::Other))
            .collect::<Vec<_>>();
        self.nesting = outer_nesting;
        Context::Nested(either(subjects))
    }

    /// Collects the classes of the compounds that may be the element, returns what the subject
    /// is. `inherited` is the subject of the pseudo-class the selector is an argument of, e.g. the
    /// element for `.a` in `&:not(.a)`
    fn selector(&mut self, selector: &ComplexSelector<'_>, inherited: Subject) -> Subject {
        let compounds = compounds(selector);
        let mut subject = Subject::Other;
        for (index, compound) in compounds.iter().enumerate() {
            let is_subject = index + 1 == compounds.len();
            let own = self.compound_subject(compound);
            let compound_subject = if is_subject { own.max(inherited) } else { own };
            self.compound(compound, compound_subject);
            if is_subject {
                subject = compound_subject;
            }
        }
        subject
    }

    fn compound(&mut self, compound: &CompoundSelector<'_>, subject: Subject) {
        for simple in &compound.children {
            match simple {
                SimpleSelector::Class(class) => {
                    let InterpolableIdent::Literal(ident) = &class.name else {
                        continue;
                    };
                    if subject != Subject::Other {
                        self.classes.push(ElementClass {
                            start: ident.span.start,
                            end: ident.span.end,
                            name: ident.name.to_owned(),
                            mixed: subject == Subject::Mixed,
                        });
                    } else if let Some(other_classes) = &mut self.other_classes {
                        other_classes.push(ident.span.start..ident.span.end);
                    }
                }
                SimpleSelector::PseudoClass(pseudo) => {
                    // `&` compounds can be nested in any selector argument
                    let inherited = if matches_element(pseudo) {
                        subject
                    } else {
                        Subject::Other
                    };
                    for argument in pseudo_class_selectors(pseudo) {
                        match argument {
                            SelectorArgument::Complex(selector) => {
                                self.selector(selector, inherited);
                            }
                            SelectorArgument::Compound(compound) => self
                                .compound(compound, inherited.max(self.compound_subject(compound))),
                        }
                    }
                }
                _ => {}
            }
        }
    }

    fn compound_subject(&self, compound: &CompoundSelector<'_>) -> Subject {
        compound_subject(
            compound,
            ElementRefs {
                nesting: self.nesting,
                scope: self.scope_root,
                reference: self.reference,
            },
        )
    }
}

/// The subjects of a list of selectors, mixed when only some of them are the element
fn either(subjects: impl IntoIterator<Item = Subject>) -> Subject {
    subjects
        .into_iter()
        .reduce(|first, second| {
            if first == second {
                first
            } else {
                Subject::Mixed
            }
        })
        .unwrap_or(Subject::Other)
}

/// What `&` and `:scope` are, and the referenced styled component that is the element
#[derive(Clone, Copy)]
struct ElementRefs<'r> {
    nesting: Subject,
    scope: Subject,
    reference: Option<ComponentReference<'r>>,
}

/// A styled component selected through its classes, or its forward reference placeholders before
/// they are resolved
#[derive(Clone, Copy)]
struct ComponentReference<'r> {
    classes: &'r [String],
    placeholders: &'r [String],
}

impl ComponentReference<'_> {
    fn matches(self, simple: &SimpleSelector<'_>) -> bool {
        let (names, name) = match simple {
            SimpleSelector::Class(class) => (self.classes, &class.name),
            SimpleSelector::Type(TypeSelector::TagName(tag)) => (self.placeholders, &tag.name.name),
            _ => return false,
        };
        let InterpolableIdent::Literal(ident) = name else {
            return false;
        };
        names.iter().any(|reference| reference == ident.name)
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

/// What a compound is from its `&` and `:scope`, or from its pseudo-classes that only match what
/// their arguments match, e.g. the element for `:is(&.a)` and mixed for `:where(&, .x)`
fn compound_subject(compound: &CompoundSelector<'_>, refs: ElementRefs<'_>) -> Subject {
    compound
        .children
        .iter()
        .map(|simple| match simple {
            _ if refs
                .reference
                .is_some_and(|reference| reference.matches(simple)) =>
            {
                Subject::Element
            }
            SimpleSelector::Nesting(_) => refs.nesting,
            SimpleSelector::PseudoClass(pseudo) if pseudo_class_name_is(pseudo, &["scope"]) => {
                refs.scope
            }
            SimpleSelector::PseudoClass(pseudo) if selects_element(pseudo) => {
                either(pseudo_class_selectors(pseudo).iter().map(|argument| {
                    match argument {
                        SelectorArgument::Complex(selector) => compounds(selector)
                            .last()
                            .map_or(Subject::Other, |subject| compound_subject(subject, refs)),
                        SelectorArgument::Compound(compound) => compound_subject(compound, refs),
                    }
                }))
            }
            _ => Subject::Other,
        })
        .max()
        .unwrap_or(Subject::Other)
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
                block(":where(&.active) { &.disabled { color: red; } }"),
                block(".x:not(&.active) { color: red; }"),
                block("&:nth-child(1 of .active):nth-last-child(2 of &.disabled) { color: red; }"),
                block("@scope (&.active) { &.disabled { color: red; } }"),
                block("@scope (&) { :scope.active { color: red; } }"),
                block("@scope (&) { :scope { &.active { color: red; } } }"),
                block("@scope (&) to (&.active > *) { .child { color: red; } }"),
                block("@scope (&) { & .child { :scope.active & { color: red; } } }"),
                block("@scope (&) { & .child { @scope (:scope.active > &) { color: red; } } }"),
                block(
                    "@scope (&) { & .c { @scope (:scope.active) { &.disabled { color: red; } } } }"
                ),
                block("@scope (&) { & .child { :scope:has(&) { &.active { color: red; } } } }"),
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
                "@scope (&) { :scope.h-active { color: red; } }",
                "@scope (&) { :scope { &.h-active { color: red; } } }",
                "@scope (&) to (&.h-active > *) { .child { color: red; } }",
                "@scope (&) { & .child { :scope.h-active & { color: red; } } }",
                "@scope (&) { & .child { @scope (:scope.h-active > &) { color: red; } } }",
                "@scope (&) { & .c { @scope (:scope.h-active) { &.h-disabled { color: red; } } } }",
                "@scope (&) { & .child { :scope:has(&) { &.h-active { color: red; } } } }",
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
            "&:hover, & .child { &.other { color: red; } }",
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
            "@scope (&) { .c { @scope (&.active) { :scope.disabled { color: red; } } } }",
            "@scope (&) { & .c { @scope (:scope .x) { &.active { color: red; } } } }",
            "@scope (&) { & .child { :scope .x { &.active { color: red; } } } }",
            "content: \"&.active\"; /* &.active */",
            "---x: &.active;",
        ] {
            assert_eq!(block(css), css);
        }
    }

    #[test]
    fn rejects_classes_of_rules_matching_other_elements_too() {
        let error = |css: &str| {
            let mappings = [("active".to_owned(), "h-active".to_owned(), true)];
            rewrite_modifiers(css, ModifierCss::Block, &mappings)
                .err()
                .map(|error| &css[error.start..error.end] == "active")
        };
        assert_eq!(
            [
                error("&:hover, & .child { &.active { color: red; } }"),
                error(":where(&, .x) { &.active { color: red; } }"),
                error(":is(&, .x).active { color: red; }"),
                error("@scope (&, & .x) { &.active { color: red; } }"),
                error("&:hover, & .child { &:focus { &.active { color: red; } } }"),
            ],
            [Some(true); 5]
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
