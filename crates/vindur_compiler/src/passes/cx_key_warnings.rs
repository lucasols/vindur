use oxc_css_parser::{
    Allocator, Span as CssSpan,
    ast::{
        AtRulePrelude, ComplexSelector, CompoundSelector, InterpolableIdent, ScopePrelude,
        SelectorList, SimpleSelector, Statement,
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
/// it. Classes of the selected elements, like `& .key`, are left alone as they are usually other
/// classes with the same name. A `$key` anywhere in the file is assumed to be what the raw class
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
        collector.statements(&stylesheet.statements);
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

/// Collects the classes of the compounds that are not the subject of a selector, e.g. `active` in
/// `.active &`, `.active + .item` or `:not(.active) &`, with the selector they are used in
#[derive(Default)]
struct ContextClassCollector<'c> {
    classes: Vec<(&'c str, CssSpan)>,
}

impl<'c> ContextClassCollector<'c> {
    fn selector_of(&self, name: &str) -> Option<CssSpan> {
        self.classes
            .iter()
            .find(|(class, _)| *class == name)
            .map(|(_, span)| *span)
    }

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
                        // The scope roots and limits are ancestors of the selected elements
                        for list in [start, end].into_iter().flatten() {
                            for selector in &list.selectors {
                                for compound in compounds(selector) {
                                    self.context_compound(compound, selector.span);
                                }
                            }
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

    /// `outer` is the span of the rule selector the selector is part of
    fn selector(&mut self, selector: &'c ComplexSelector<'c>, outer: CssSpan) {
        let compounds = compounds(selector);
        let subject = compounds.len().saturating_sub(1);
        for (index, compound) in compounds.into_iter().enumerate() {
            if index == subject {
                self.subject_compound(compound, outer);
            } else {
                self.context_compound(compound, outer);
            }
        }
    }

    /// Only the selector arguments of the subject can select other elements, e.g. `:is(.a &)`
    fn subject_compound(&mut self, compound: &'c CompoundSelector<'c>, outer: CssSpan) {
        for simple in &compound.children {
            if let SimpleSelector::PseudoClass(pseudo) = simple {
                for argument in pseudo_class_selectors(pseudo) {
                    if let SelectorArgument::Complex(selector) = argument {
                        self.selector(selector, outer);
                    }
                }
            }
        }
    }

    fn context_compound(&mut self, compound: &'c CompoundSelector<'c>, outer: CssSpan) {
        for simple in &compound.children {
            match simple {
                SimpleSelector::Class(class) => {
                    if let InterpolableIdent::Literal(ident) = &class.name {
                        self.classes.push((ident.name, outer));
                    }
                }
                SimpleSelector::PseudoClass(pseudo) => {
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
                _ => {}
            }
        }
    }
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
            ],
            [true; 6]
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
            ],
            [false; 8]
        );
    }
}
