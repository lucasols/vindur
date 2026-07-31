use oxc_allocator::Allocator;
use oxc_ast::ast::{
    ImportDeclarationSpecifier, ObjectExpression, Program, Statement, TSTypeLiteral,
};
use oxc_ast_visit::{Visit, walk};
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType, Span};

use crate::{CompilerDiagnostic, edit::apply_edits};

pub(crate) fn normalize_code(
    file_path: &str,
    source: &str,
    source_type: SourceType,
) -> Result<String, CompilerDiagnostic> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, source_type).parse();
    if let Some(diagnostic) = parsed.diagnostics.first() {
        return Err(CompilerDiagnostic::error(
            file_path,
            source,
            diagnostic
                .labels
                .as_slice()
                .first()
                .map_or(Span::new(0, 0), |label| {
                    Span::new(label.offset(), label.offset() + label.len())
                }),
            format!("Internal compiler error after source edits: {diagnostic}"),
        ));
    }

    let mut edits = Vec::new();
    merge_vindur_imports(&parsed.program, source, &mut edits);
    let mut cursor = 0usize;

    for (index, statement) in parsed.program.body.iter().enumerate() {
        let span = statement.span();
        let start = span.start as usize;
        let end = span.end as usize;
        let gap = &source[cursor..start];
        if gap.contains('\n') && gap.trim().is_empty() {
            edits.push(crate::edit::Edit {
                span: Span::new(cursor as u32, start as u32),
                replacement: if index == 0 {
                    String::new()
                } else {
                    "\n".to_owned()
                },
            });
        }
        if statement_needs_semicolon(statement) && !source[cursor..end].ends_with(';') {
            edits.push(crate::edit::Edit {
                span: Span::new(span.end, span.end),
                replacement: ";".to_owned(),
            });
        }
        cursor = end;
    }

    if source[cursor..].trim().is_empty() && cursor < source.len() {
        edits.push(crate::edit::Edit {
            span: Span::new(cursor as u32, source.len() as u32),
            replacement: String::new(),
        });
    }

    ObjectWrapNormalizer {
        source,
        edits: &mut edits,
    }
    .visit_program(&parsed.program);

    let code = apply_edits(file_path, source, &mut edits)?;
    if code.starts_with("import {")
        && code.contains("from \"vindur\";\n\n")
        && !code.contains("from \"vindur\";\n\n//")
    {
        Ok(code.replacen("from \"vindur\";\n\n", "from \"vindur\";\n", 1))
    } else {
        Ok(code)
    }
}

fn merge_vindur_imports(program: &Program<'_>, source: &str, edits: &mut Vec<crate::edit::Edit>) {
    let imports = program
        .body
        .iter()
        .filter_map(|statement| {
            let Statement::ImportDeclaration(import) = statement else {
                return None;
            };
            (import.source.value.as_str() == "vindur").then_some(&**import)
        })
        .collect::<Vec<_>>();
    if imports.len() < 2 {
        return;
    }
    let mut public = Vec::new();
    let mut helpers = Vec::new();
    for import in &imports {
        let Some(specifiers) = &import.specifiers else {
            continue;
        };
        for specifier in specifiers {
            let span = specifier.span();
            let value = source[span.start as usize..span.end as usize].to_owned();
            let name = match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                    specifier.imported.name().as_str()
                }
                _ => "",
            };
            if matches!(
                name,
                "_vSC" | "_vCWM" | "cx" | "mergeClassNames" | "mergeStyles"
            ) {
                if !helpers.contains(&value) {
                    helpers.push(value);
                }
            } else if !public.contains(&value) {
                public.push(value);
            }
        }
    }
    public.extend(helpers);
    let Some(first) = imports.first() else {
        return;
    };
    edits.push(crate::edit::Edit {
        span: first.span,
        replacement: format!("import {{ {} }} from \"vindur\";", public.join(", ")),
    });
    for import in imports.iter().skip(1) {
        edits.push(crate::edit::Edit {
            span: import.span,
            replacement: String::new(),
        });
    }
}

struct ObjectWrapNormalizer<'a> {
    source: &'a str,
    edits: &'a mut Vec<crate::edit::Edit>,
}

impl<'a> Visit<'a> for ObjectWrapNormalizer<'_> {
    fn visit_object_expression(&mut self, object: &ObjectExpression<'a>) {
        let start = object.span.start as usize + 1;
        let end = object.span.end.saturating_sub(1) as usize;
        if start < end && !self.source[start..end].contains('\n') {
            self.edits.push(crate::edit::Edit {
                span: Span::new(start as u32, start as u32),
                replacement: "\n".to_owned(),
            });
            self.edits.push(crate::edit::Edit {
                span: Span::new(end as u32, end as u32),
                replacement: "\n".to_owned(),
            });
        }
        walk::walk_object_expression(self, object);
    }

    fn visit_ts_type_literal(&mut self, literal: &TSTypeLiteral<'a>) {
        let start = literal.span.start as usize + 1;
        let end = literal.span.end.saturating_sub(1) as usize;
        let prefix = &self.source[..literal.span.start as usize];
        if start < end
            && !self.source[start..end].contains('\n')
            && prefix.trim_end().ends_with("FC<")
        {
            self.edits.push(crate::edit::Edit {
                span: Span::new(start as u32, start as u32),
                replacement: "\n".to_owned(),
            });
            self.edits.push(crate::edit::Edit {
                span: Span::new(end as u32, end as u32),
                replacement: "\n".to_owned(),
            });
        }
        walk::walk_ts_type_literal(self, literal);
    }
}

fn statement_needs_semicolon(statement: &Statement<'_>) -> bool {
    matches!(
        statement,
        Statement::VariableDeclaration(_) | Statement::ExpressionStatement(_)
    ) || matches!(
        statement,
        Statement::ExportNamedDeclaration(export)
            if matches!(
                export.declaration,
                Some(oxc_ast::ast::Declaration::VariableDeclaration(_))
            )
    )
}
