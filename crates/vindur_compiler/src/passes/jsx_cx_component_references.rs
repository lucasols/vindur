use oxc_css_parser::Allocator;
use oxc_span::Span;

use crate::CompilerDiagnostic;

use super::{css_syntax::parse_style_block, cx_modifier_selectors::referenced_classes};

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
            if referenced_classes(
                &stylesheet.statements,
                &modifier.classes,
                &modifier.placeholders,
            )
            .iter()
            .any(|class| class.name == modifier.class_name)
            {
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
                ".list { :is(.item).active & { color: red; } }",
                ".list { & .item { &.active { color: red; } } }",
                ".list { @scope (.item) { :scope.active { color: red; } } }",
            ]
            .map(rejects),
            [true; 8]
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
                ".list { & .item .x { &.active { color: red; } } }",
            ]
            .map(rejects),
            [false; 6]
        );
    }
}
