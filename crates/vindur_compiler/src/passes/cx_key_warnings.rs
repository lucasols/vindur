use oxc_css_parser::{
    Allocator, Span as CssSpan,
    ast::{
        AtRulePrelude, ComplexSelector, CompoundSelector, InterpolableIdent, PseudoClassSelector,
        ScopePrelude, SimpleSelector, Statement,
    },
};
use oxc_span::Span;
use rustc_hash::FxHashSet;

use crate::CompilerDiagnostic;

use super::{
    css_syntax::parse_style_block,
    cx_modifier_selectors::{SelectorArgument, compounds, pseudo_class_selectors},
};

/// cx prop keys of a file, `$` keys keep their name and the others are hashed
#[derive(Default)]
pub(crate) struct CxKeyUsages {
    pub hashed: Vec<(String, Span)>,
    pub unhashed: FxHashSet<String>,
}

/// A hashed cx key only rewrites the `&.key` selectors of its own styles, so a raw `.key` class
/// on an ancestor or sibling in the file's css, e.g. `.key &` in another component, never matches
/// it. Classes of the selected elements and their descendants, like `& .key .icon`, are left alone
/// as they are usually other classes with the same name. A `$key` anywhere in the file is assumed to be what the raw class
/// selects, so it silences the warning
pub(super) fn raw_hashed_cx_key_warnings(
    usages: &CxKeyUsages,
    css_rules: &[String],
    file_path: &str,
    source: &str,
) -> Result<Vec<CompilerDiagnostic>, CompilerDiagnostic> {
    let candidates = usages
        .hashed
        .iter()
        .filter(|(name, _)| !usages.unhashed.contains(name))
        .collect::<Vec<_>>();
    let mut warnings = Vec::new();
    let mut warned = FxHashSet::default();
    for rule in css_rules {
        let Some((_, first_span)) = candidates
            .iter()
            .find(|(name, _)| rule.contains(name.as_str()))
        else {
            continue;
        };
        let allocator = Allocator::default();
        let stylesheet = parse_style_block(&allocator, rule).map_err(|error| {
            CompilerDiagnostic::error(file_path, source, *first_span, error.message)
        })?;
        let mut collector = ContextClassCollector::default();
        collector.statements(&stylesheet.statements, None);
        for (name, span) in &candidates {
            let Some(selector) = collector.selector_of(name) else {
                continue;
            };
            if !warned.insert(name.as_str()) {
                continue;
            }
            warnings.push(CompilerDiagnostic::warning(
                file_path,
                source,
                *span,
                format!(
                    "cx key \"{name}\" is hashed, but the selector \"{selector}\" uses the class \".{name}\", which will never match it. Use \"${name}\" to keep the class name, or rename one of the classes",
                    selector = rule[selector.start..selector.end].trim()
                ),
            ));
        }
    }
    Ok(warnings)
}

/// Collects the classes of the compounds that select ancestors or siblings of other elements, e.g.
/// `active` in `.active &`, `.active + .item` or `:not(.active) &`, with the selector they are used
/// in. In nested rules only the compounds before `&` are collected, the others select the parent
/// element or its descendants and later siblings, like the `:has()` arguments
#[derive(Default)]
struct ContextClassCollector<'c> {
    classes: Vec<(&'c str, CssSpan)>,
}

/// The classes of the top-level rule subject a nested rule is part of, with its selector
type RootClasses<'c> = [(&'c str, CssSpan)];

impl<'c> ContextClassCollector<'c> {
    fn selector_of(&self, name: &str) -> Option<CssSpan> {
        self.classes
            .iter()
            .find(|(class, _)| *class == name)
            .map(|(_, span)| *span)
    }

    fn statements(&mut self, statements: &'c [Statement<'c>], root: Option<&RootClasses<'c>>) {
        for statement in statements {
            match statement {
                Statement::QualifiedRule(rule) => match root {
                    Some(root) => {
                        for selector in &rule.selector.selectors {
                            self.nested_selector(selector, selector.span, root);
                        }
                        self.statements(&rule.block.statements, Some(root));
                    }
                    None => {
                        let mut root = Vec::new();
                        for selector in &rule.selector.selectors {
                            self.top_level_selector(selector, selector.span);
                            if let Some(subject) = compounds(selector).last() {
                                root.extend(
                                    subject_classes(subject).map(|class| (class, selector.span)),
                                );
                            }
                        }
                        self.statements(&rule.block.statements, Some(&root));
                    }
                },
                Statement::AtRule(rule) => {
                    if let Some(AtRulePrelude::Scope(prelude)) = &rule.prelude {
                        // The scope limits are descendants of the roots, so only the roots are
                        // ancestors of the selected elements
                        let start = match prelude.as_ref() {
                            ScopePrelude::StartOnly(start) => &start.selector,
                            ScopePrelude::EndOnly(_) => &None,
                            ScopePrelude::Both(both) => &both.start.selector,
                        };
                        for selector in start.iter().flat_map(|list| &list.selectors) {
                            match root {
                                Some(root) => self.nested_selector(selector, selector.span, root),
                                None => {
                                    for compound in compounds(selector) {
                                        self.context_compound(compound, selector.span);
                                    }
                                }
                            }
                        }
                    }
                    if let Some(block) = &rule.block {
                        self.statements(&block.statements, root);
                    }
                }
                _ => {}
            }
        }
    }

    /// `outer` is the span of the rule selector the selector is part of
    fn top_level_selector(&mut self, selector: &'c ComplexSelector<'c>, outer: CssSpan) {
        let compounds = compounds(selector);
        let subject = compounds.len().saturating_sub(1);
        for (index, compound) in compounds.into_iter().enumerate() {
            if index == subject {
                // Only the selector arguments of the subject can select other elements
                for argument in selector_arguments(compound) {
                    self.top_level_selector(argument, outer);
                }
            } else {
                self.context_compound(compound, outer);
            }
        }
    }

    /// A selector without `&` is nested as `& selector`, so the parent is an ancestor
    fn nested_selector(
        &mut self,
        selector: &'c ComplexSelector<'c>,
        outer: CssSpan,
        root: &RootClasses<'c>,
    ) {
        let chain = compounds(selector);
        let anchor = chain.iter().position(|compound| contains_nesting(compound));
        if anchor.is_none_or(|anchor| anchor + 1 < chain.len()) {
            self.classes.extend_from_slice(root);
        }
        let Some(anchor) = anchor else {
            return;
        };
        for compound in &chain[..anchor] {
            self.context_compound(compound, outer);
        }
        for compound in &chain[anchor..] {
            for argument in selector_arguments(compound) {
                if compounds(argument).into_iter().any(contains_nesting) {
                    self.nested_selector(argument, outer, root);
                }
            }
        }
    }

    fn context_compound(&mut self, compound: &'c CompoundSelector<'c>, outer: CssSpan) {
        self.classes
            .extend(subject_classes(compound).map(|class| (class, outer)));
        for simple in &compound.children {
            let SimpleSelector::PseudoClass(pseudo) = simple else {
                continue;
            };
            if is_has(pseudo) {
                continue;
            }
            for argument in pseudo_class_selectors(pseudo) {
                match argument {
                    SelectorArgument::Complex(selector) => {
                        for compound in compounds(selector) {
                            self.context_compound(compound, outer);
                        }
                    }
                    SelectorArgument::Compound(compound) => {
                        self.context_compound(compound, outer);
                    }
                }
            }
        }
    }
}

fn subject_classes<'c>(compound: &'c CompoundSelector<'c>) -> impl Iterator<Item = &'c str> {
    compound.children.iter().filter_map(|simple| match simple {
        SimpleSelector::Class(class) => match &class.name {
            InterpolableIdent::Literal(ident) => Some(ident.name),
            _ => None,
        },
        _ => None,
    })
}

/// The complex selector arguments of the pseudo-classes of a compound, except `:has()` as it
/// selects descendants and later siblings
fn selector_arguments<'c>(
    compound: &'c CompoundSelector<'c>,
) -> impl Iterator<Item = &'c ComplexSelector<'c>> {
    compound
        .children
        .iter()
        .filter_map(|simple| match simple {
            SimpleSelector::PseudoClass(pseudo) if !is_has(pseudo) => Some(pseudo),
            _ => None,
        })
        .flat_map(|pseudo| pseudo_class_selectors(pseudo))
        .filter_map(|argument| match argument {
            SelectorArgument::Complex(selector) => Some(selector),
            SelectorArgument::Compound(_) => None,
        })
}

fn contains_nesting(compound: &CompoundSelector<'_>) -> bool {
    compound.children.iter().any(|simple| match simple {
        SimpleSelector::Nesting(_) => true,
        SimpleSelector::PseudoClass(pseudo) if !is_has(pseudo) => pseudo_class_selectors(pseudo)
            .into_iter()
            .any(|argument| match argument {
                SelectorArgument::Complex(selector) => {
                    compounds(selector).into_iter().any(contains_nesting)
                }
                SelectorArgument::Compound(compound) => contains_nesting(compound),
            }),
        _ => false,
    })
}

fn is_has(pseudo: &PseudoClassSelector<'_>) -> bool {
    matches!(&pseudo.name, InterpolableIdent::Literal(name) if name.name.eq_ignore_ascii_case("has"))
}

#[cfg(test)]
mod tests {
    use oxc_span::Span;

    use super::{CxKeyUsages, raw_hashed_cx_key_warnings};

    fn warns(rule: &str) -> bool {
        let usages = CxKeyUsages {
            hashed: vec![("active".to_owned(), Span::new(0, 0))],
            unhashed: Default::default(),
        };
        match raw_hashed_cx_key_warnings(&usages, &[rule.to_owned()], "file.tsx", "") {
            Ok(warnings) => !warnings.is_empty(),
            Err(error) => panic!("{}", error.message),
        }
    }

    #[test]
    fn warns_about_classes_of_ancestors_and_siblings() {
        assert_eq!(
            [
                warns(".item { .active & { color: red; } }"),
                warns(".item { .active + & { color: red; } }"),
                warns(".item { .menu:not(.active) & { color: red; } }"),
                warns(".item { &:is(.active &) { color: red; } }"),
                warns(".active .icon { color: red; }"),
                warns("@scope (.active) { .icon { color: red; } }"),
                warns(".item { @scope (.active &) { .icon { color: red; } } }"),
                warns(".active { & .icon { color: red; } }"),
                warns(".active { &:hover { .icon { color: red; } } }"),
            ],
            [true; 9]
        );
    }

    #[test]
    fn ignores_classes_of_the_selected_elements_and_other_css() {
        assert_eq!(
            [
                warns(".item { &.active { color: red; } }"),
                warns(".item { & .active { color: red; } }"),
                warns(".item { & .tab { &.active { color: red; } } }"),
                warns(".item { &:not(.active) { color: red; } }"),
                warns(".item { &:has(.active) { color: red; } }"),
                warns(".item { /* .active & */ color: red; }"),
                warns(".item { background: url(/a.active); content: \".active &\"; }"),
                warns(".item { .active-extra & { color: red; } }"),
                warns(".item { & .active .icon { color: red; } }"),
                warns(".item { .active .icon { color: red; } }"),
                warns(".item { &.active .icon { color: red; } }"),
                warns(".item { &:has(.active .icon) { color: red; } }"),
                warns(".item { &:has(+ .active) { color: red; } }"),
                warns(".item { @scope (&) to (.active) { .icon { color: red; } } }"),
                warns(".item { @scope (.active) { .icon { color: red; } } }"),
                warns(".active { color: red; }"),
            ],
            [false; 16]
        );
    }
}
