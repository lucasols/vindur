use oxc_ast::ast::{
    Expression, JSXAttribute, JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXElement,
    JSXExpression, Program, TaggedTemplateExpression,
};
use oxc_ast_visit::{Visit, walk};

use crate::semantic::VindurImports;

pub(crate) fn css_template_offsets(program: &Program<'_>, imports: &VindurImports<'_>) -> Vec<u32> {
    let mut visitor = CssTemplateOffsetVisitor {
        imports,
        offsets: Vec::new(),
    };
    visitor.visit_program(program);
    visitor.offsets.sort_unstable();
    visitor.offsets.dedup();
    visitor.offsets
}

struct CssTemplateOffsetVisitor<'a> {
    imports: &'a VindurImports<'a>,
    offsets: Vec<u32>,
}

impl<'a> Visit<'a> for CssTemplateOffsetVisitor<'_> {
    fn visit_tagged_template_expression(&mut self, tagged: &TaggedTemplateExpression<'a>) {
        if is_css_tag(&tagged.tag, self.imports) {
            self.offsets.push(tagged.quasi.span.start);
        }
        walk::walk_tagged_template_expression(self, tagged);
    }

    fn visit_jsx_element(&mut self, element: &JSXElement<'a>) {
        for item in &element.opening_element.attributes {
            let JSXAttributeItem::Attribute(attribute) = item else {
                continue;
            };
            if !is_css_attribute(attribute) {
                continue;
            }
            let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
                continue;
            };
            if let JSXExpression::TemplateLiteral(template) = &container.expression {
                self.offsets.push(template.span.start);
            }
        }
        walk::walk_jsx_element(self, element);
    }
}

fn is_css_tag(tag: &Expression<'_>, imports: &VindurImports<'_>) -> bool {
    match tag {
        Expression::Identifier(identifier) => imports
            .get_identifier(identifier)
            .is_some_and(|name| matches!(name, "css" | "keyframes" | "createGlobalStyle")),
        Expression::StaticMemberExpression(member) => {
            matches!(&member.object, Expression::Identifier(identifier)
                if imports.get_identifier(identifier) == Some("styled"))
        }
        Expression::CallExpression(call) => {
            matches!(&call.callee, Expression::Identifier(identifier)
                if imports.get_identifier(identifier) == Some("styled"))
        }
        _ => false,
    }
}

fn is_css_attribute(attribute: &JSXAttribute<'_>) -> bool {
    matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name.as_str() == "css")
}

#[cfg(test)]
mod tests {
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_semantic::SemanticBuilder;
    use oxc_span::SourceType;

    use super::css_template_offsets;
    use crate::{passes::import_analysis::collect_vindur_imports, semantic::VindurImports};

    #[test]
    fn collects_oxc_template_offsets_for_css_output() {
        let source = "import { css, keyframes } from 'vindur';\nconst a = css`a`;\nconst b = keyframes`b`;\nconst App = () => <div css={`c`} />;";
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source, SourceType::tsx()).parse();
        assert!(parsed.diagnostics.is_empty());
        let semantic = SemanticBuilder::new_compiler()
            .build(&parsed.program)
            .semantic;
        let mut imports = VindurImports::new(semantic.scoping());
        collect_vindur_imports(&parsed.program, source, &mut imports, &mut Vec::new());
        let offsets = css_template_offsets(&parsed.program, &imports);
        let expected = source
            .match_indices('`')
            .step_by(2)
            .map(|(offset, _)| u32::try_from(offset).expect("source offset"))
            .collect::<Vec<_>>();

        assert_eq!(offsets, expected);
    }
}
