use oxc_ast::ast::{
    JSXAttribute, JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXElement,
    JSXElementName, JSXExpression, ObjectPropertyKind, Program,
};
use oxc_ast_visit::{Visit, walk};
use rustc_hash::{FxHashMap, FxHashSet};

#[derive(Clone, Copy)]
pub(crate) struct IdEvent {
    pub start: u32,
    pub count: u32,
}

struct JsxFeature {
    start: u32,
    css_count: u32,
    cx_keys: Vec<String>,
}

pub(crate) fn collect_jsx_id_events(program: &Program<'_>) -> Vec<IdEvent> {
    let mut visitor = JsxFeatureVisitor {
        features: Vec::new(),
    };
    visitor.visit_program(program);
    visitor.features.sort_by_key(|feature| feature.start);

    let mut allocated_cx_keys = FxHashSet::default();
    visitor
        .features
        .into_iter()
        .map(|feature| {
            let mut count = feature.css_count;
            for key in feature.cx_keys {
                if allocated_cx_keys.insert(key) {
                    count += 1;
                }
            }
            IdEvent {
                start: feature.start,
                count,
            }
        })
        .collect()
}

pub(crate) fn jsx_id_starts(
    jsx_events: &[IdEvent],
    declaration_events: &[IdEvent],
) -> FxHashMap<u32, u32> {
    let mut starts = FxHashMap::default();
    let mut allocated_jsx_ids = 0_u32;
    let mut allocated_declaration_ids = 0_u32;
    let mut declaration_index = 0_usize;
    for feature in jsx_events {
        while let Some(event) = declaration_events.get(declaration_index)
            && event.start < feature.start
        {
            allocated_declaration_ids += event.count;
            declaration_index += 1;
        }
        starts.insert(
            feature.start,
            1 + allocated_declaration_ids + allocated_jsx_ids,
        );
        allocated_jsx_ids += feature.count;
    }
    starts
}

struct JsxFeatureVisitor {
    features: Vec<JsxFeature>,
}

impl<'a> Visit<'a> for JsxFeatureVisitor {
    fn visit_jsx_element(&mut self, element: &JSXElement<'a>) {
        let css = find_attribute(element, "css");
        let cx = find_attribute(element, "cx");
        if css.is_some() || cx.is_some() {
            let css_count = u32::from(
                cx.is_some() && css.is_some() || css.is_some_and(css_attribute_allocates_class),
            );
            let context = jsx_name(&element.opening_element.name)
                .filter(|name| name.chars().next().is_some_and(char::is_uppercase))
                .map_or_else(
                    || format!("css:{}", element.span.start),
                    |name| format!("styled:{name}"),
                );
            let cx_keys = cx
                .map(|attribute| cx_class_names(attribute, &context))
                .unwrap_or_default();
            self.features.push(JsxFeature {
                start: element.span.start,
                css_count,
                cx_keys,
            });
        }
        walk::walk_jsx_element(self, element);
    }
}

fn css_attribute_allocates_class(attribute: &JSXAttribute<'_>) -> bool {
    matches!(
        &attribute.value,
        Some(JSXAttributeValue::ExpressionContainer(container))
            if matches!(&container.expression, JSXExpression::TemplateLiteral(_))
    )
}

fn cx_class_names(attribute: &JSXAttribute<'_>, context: &str) -> Vec<String> {
    let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
        return Vec::new();
    };
    let JSXExpression::ObjectExpression(object) = &container.expression else {
        return Vec::new();
    };
    object
        .properties
        .iter()
        .filter_map(|property| {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                return None;
            };
            let name = property.key.static_name()?.into_owned();
            (!name.starts_with('$')).then(|| format!("{context}:{name}"))
        })
        .collect()
}

fn find_attribute<'a>(element: &'a JSXElement<'a>, expected: &str) -> Option<&'a JSXAttribute<'a>> {
    element.opening_element.attributes.iter().find_map(|item| {
        let JSXAttributeItem::Attribute(attribute) = item else {
            return None;
        };
        let JSXAttributeName::Identifier(name) = &attribute.name else {
            return None;
        };
        (name.name.as_str() == expected).then_some(&**attribute)
    })
}

fn jsx_name<'a>(name: &'a JSXElementName<'a>) -> Option<&'a str> {
    match name {
        JSXElementName::Identifier(identifier) => Some(identifier.name.as_str()),
        JSXElementName::IdentifierReference(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{IdEvent, collect_jsx_id_events, jsx_id_starts};
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    #[test]
    fn reserves_jsx_ids_around_declarations_in_source_order() {
        let source = r#"
import { css, cx, styled } from 'vindur';
const base = css`color: red;`;
const A = <div cx={{ active: a, disabled: d }} css={`color: blue;`} />;
const Button = styled.button`color: green;`;
const B = <div cx={{ active: a, loading: l }} css={`color: yellow;`} />;
"#;
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source, SourceType::tsx()).parse();
        assert!(parsed.diagnostics.is_empty());
        let events = [
            IdEvent {
                start: u32::try_from(source.find("const base").expect("base declaration"))
                    .expect("source offset"),
                count: 1,
            },
            IdEvent {
                start: u32::try_from(source.find("const Button").expect("styled declaration"))
                    .expect("source offset"),
                count: 1,
            },
        ];
        let jsx_events = collect_jsx_id_events(&parsed.program);
        let starts = jsx_id_starts(&jsx_events, &events);
        let mut reservations = starts.into_iter().collect::<Vec<_>>();
        reservations.sort_by_key(|(offset, _)| *offset);

        assert_eq!(
            reservations
                .into_iter()
                .map(|(_, index)| index)
                .collect::<Vec<_>>(),
            vec![2, 6]
        );
    }
}
