use oxc_ast::ast::{CallExpression, Expression, Program, TaggedTemplateExpression};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::Scoping;
use oxc_span::Span;
use rustc_hash::FxHashMap;

use crate::{CompilerDiagnostic, edit::Edit, facts::StaticValue, semantic::VindurImports};

use super::{
    css::{clean_css, generate_class_rules},
    css_syntax::{BlockKind, css_error_diagnostic},
    scoped::{ScopedVariables, process_scoped_variables},
    static_value::{TemplateContext, evaluate_template},
    vindur_fn_references::is_styled_tag,
};

pub(crate) struct DirectTransform<'a> {
    pub imports: &'a VindurImports<'a>,
    pub constants: &'a FxHashMap<String, StaticValue>,
    pub scoping: &'a Scoping,
    pub handled_spans: &'a [Span],
    pub file_hash: &'a str,
    pub file_path: &'a str,
    pub source: &'a str,
    pub edits: &'a mut Vec<Edit>,
    pub css_rules: &'a mut Vec<String>,
    pub id_index: &'a mut u32,
    pub dev: bool,
    pub scoped_variables: &'a mut ScopedVariables,
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
    // Top level declarations get their ids, another call would throw at runtime. Their calls are
    // replaced by an edit of the call itself, a call inside another edit, like in `.attrs()`, isn't
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if self.diagnostic.is_some() {
            return;
        }
        if let Expression::Identifier(callee) = &call.callee
            && self
                .output
                .imports
                .matches_import_or_global(callee, "createDynamicCssColor")
            && !self.output.handled_spans.contains(&call.span)
        {
            self.diagnostic = Some(CompilerDiagnostic::error(
                self.output.file_path,
                self.output.source,
                call.span,
                "createDynamicCssColor() must be the direct initializer of a top level `const` declaration, e.g. `const accent = createDynamicCssColor()`".to_owned(),
            ));
            return;
        }
        walk::walk_call_expression(self, call);
    }

    fn visit_tagged_template_expression(&mut self, tagged: &TaggedTemplateExpression<'a>) {
        if self.diagnostic.is_some() {
            return;
        }
        // The runtime arguments of a handled tag, like `.attrs({ ... })`, are still checked
        if self.is_handled(tagged.span) {
            self.visit_expression(&tagged.tag);
            return;
        }

        if is_styled_tag(&tagged.tag, self.output.imports) {
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
        // Top level global styles are handled before, their styles can't be added anywhere else
        if tag_name == "createGlobalStyle" {
            self.diagnostic = Some(CompilerDiagnostic::error(
                self.output.file_path,
                self.output.source,
                tagged.span,
                "createGlobalStyle can only be used at the top level of the module, as a statement or in its own `const` declaration".to_owned(),
            ));
            return;
        }
        if !matches!(tag_name, "css" | "keyframes") {
            walk::walk_tagged_template_expression(self, tagged);
            return;
        }

        let content = match evaluate_template(
            &tagged.quasi,
            self.output.constants,
            self.output.scoping,
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
        let rules = process_scoped_variables(
            &content,
            BlockKind::from_tag_type(tag_name),
            tagged.span,
            self.output.file_hash,
            self.output.dev,
            self.output.id_index,
            self.output.scoped_variables,
        )
        .and_then(|content| {
            if content.is_empty() {
                Ok(Vec::new())
            } else if tag_name == "keyframes" {
                Ok(vec![format!(
                    "@keyframes {generated_name} {{\n  {content}\n}}"
                )])
            } else {
                generate_class_rules(&generated_name, &content)
            }
        });
        match rules {
            Ok(rules) => self.output.css_rules.extend(rules),
            Err(error) => {
                self.diagnostic = Some(css_error_diagnostic(
                    self.output.file_path,
                    self.output.source,
                    tagged.span,
                    error,
                ));
                return;
            }
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

fn imported_tag_name<'a>(tag: &Expression<'_>, imports: &'a VindurImports<'_>) -> Option<&'a str> {
    imports.get_expression(tag)
}
