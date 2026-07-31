use oxc_ast::ast::{Expression, Program, TaggedTemplateExpression};
use oxc_ast_visit::{Visit, walk};
use oxc_span::Span;
use rustc_hash::FxHashMap;

use crate::{CompilerDiagnostic, edit::Edit, facts::StaticValue};

use super::{
    css::{clean_css, generate_class_rules},
    scoped::process_scoped_variables,
    static_value::{TemplateContext, evaluate_template},
    styled::styled_tag_element,
};

pub(crate) struct DirectTransform<'a> {
    pub imports: &'a FxHashMap<String, String>,
    pub constants: &'a FxHashMap<String, StaticValue>,
    pub handled_spans: &'a [Span],
    pub file_hash: &'a str,
    pub file_path: &'a str,
    pub source: &'a str,
    pub edits: &'a mut Vec<Edit>,
    pub css_rules: &'a mut Vec<String>,
    pub id_index: &'a mut u32,
    pub dev: bool,
    pub scoped_variables: &'a mut FxHashMap<String, String>,
}

pub(crate) fn transform_direct_tags(
    program: &Program<'_>,
    output: DirectTransform<'_>,
) -> Result<(), CompilerDiagnostic> {
    let mut visitor = DirectTagVisitor {
        output,
        diagnostic: None,
    };
    visitor.visit_program(program);
    match visitor.diagnostic {
        Some(diagnostic) => Err(diagnostic),
        None => Ok(()),
    }
}

struct DirectTagVisitor<'a> {
    output: DirectTransform<'a>,
    diagnostic: Option<CompilerDiagnostic>,
}

impl<'a> Visit<'a> for DirectTagVisitor<'_> {
    fn visit_tagged_template_expression(&mut self, tagged: &TaggedTemplateExpression<'a>) {
        if self.diagnostic.is_some() || self.is_handled(tagged.span) {
            return;
        }

        if styled_tag_element(&tagged.tag, self.output.imports).is_some() {
            self.diagnostic = Some(CompilerDiagnostic::error(
                self.output.file_path,
                self.output.source,
                tagged.span,
                "Inline styled component usage is not supported. Please assign styled components to a variable first."
                    .to_owned(),
            ));
            return;
        }

        let Some(tag_name) = imported_tag_name(&tagged.tag, self.output.imports) else {
            walk::walk_tagged_template_expression(self, tagged);
            return;
        };
        if !matches!(tag_name, "css" | "keyframes") {
            walk::walk_tagged_template_expression(self, tagged);
            return;
        }

        let content = match evaluate_template(
            &tagged.quasi,
            self.output.constants,
            self.output.file_path,
            self.output.source,
            &TemplateContext {
                variable_name: None,
                tag_type: tag_name,
            },
        ) {
            Ok(content) => clean_css(&content),
            Err(diagnostic) => {
                self.diagnostic = Some(diagnostic);
                return;
            }
        };
        let generated_name = format!("{}-{}", self.output.file_hash, self.output.id_index);
        *self.output.id_index += 1;
        let content = process_scoped_variables(
            &content,
            self.output.file_hash,
            self.output.dev,
            self.output.id_index,
            self.output.scoped_variables,
        );
        if !content.is_empty() {
            let rules = if tag_name == "keyframes" {
                vec![format!("@keyframes {generated_name} {{\n  {content}\n}}")]
            } else {
                generate_class_rules(&generated_name, &content)
            };
            self.output.css_rules.extend(rules);
        }
        self.output.edits.push(Edit {
            span: tagged.span,
            replacement: format!("\"{generated_name}\""),
        });
    }
}

impl DirectTagVisitor<'_> {
    fn is_handled(&self, span: Span) -> bool {
        self.output
            .handled_spans
            .iter()
            .any(|handled| handled.start <= span.start && handled.end >= span.end)
    }
}

fn imported_tag_name<'a>(
    tag: &Expression<'_>,
    imports: &'a FxHashMap<String, String>,
) -> Option<&'a str> {
    let Expression::Identifier(identifier) = tag else {
        return None;
    };
    imports.get(identifier.name.as_str()).map(String::as_str)
}
