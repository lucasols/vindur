use oxc_ast::ast::{TemplateElement, TemplateLiteral};
use oxc_span::{GetSpan, Span};

use crate::CompilerDiagnostic;

use super::css_syntax::{BlockKind, CssError, validate_style_block};
use super::static_value::TemplateContext;
use super::unsupported_css_syntax::{SegmentOrigin, TemplateSegment, template_source_span};

/// The CSS produced by a style template, with the mapping from CSS offsets back to the source
#[derive(Default)]
pub(crate) struct EvaluatedTemplate {
    pub css: String,
    /// Indices of the CSS class interpolations that were evaluated as selectors
    pub selector_classes: Vec<usize>,
    pub segments: Vec<TemplateSegment>,
}

impl EvaluatedTemplate {
    pub(crate) fn map_quasi(&mut self, css_start: usize, quasi: &TemplateElement<'_>) {
        self.push_segment(css_start, SegmentOrigin::Quasi(quasi.span));
    }

    pub(crate) fn map_expression(&mut self, css_start: usize, span: Span) {
        self.push_segment(css_start, SegmentOrigin::Interpolation(span));
    }

    fn push_segment(&mut self, css_start: usize, origin: SegmentOrigin) {
        self.segments.push(TemplateSegment {
            range: css_start..self.css.len(),
            origin,
        });
    }

    /// Maps a CSS error to the source, a zero width error is widened to the next character
    fn source_span(&self, error: &CssError, source: &str, fallback: Span) -> Span {
        let end = error.end.max(error.start + 1).min(self.css.len());
        template_source_span(&self.css, source, &self.segments, error.start..end)
            .map_or(fallback, |(span, _)| span)
    }
}

/// Fails with a source located error when the evaluated CSS is invalid. When treating a CSS class
/// interpolation as a style extension fixes the CSS, or moves the error past it, the error points
/// to the missing `;`
pub(crate) fn validate_template_css(
    evaluated: &EvaluatedTemplate,
    template: &TemplateLiteral<'_>,
    file_path: &str,
    source: &str,
    context: &TemplateContext<'_>,
    rebuild_with_extension: impl Fn(usize) -> Result<EvaluatedTemplate, CompilerDiagnostic>,
) -> Result<(), CompilerDiagnostic> {
    let kind = BlockKind::from_tag_type(context.tag_type);
    let Err(error) = validate_style_block(&evaluated.css, kind) else {
        return Ok(());
    };
    let span = evaluated.source_span(&error, source, template.span);
    for &index in &evaluated.selector_classes {
        let Some(expression) = template.expressions.get(index) else {
            continue;
        };
        let rebuilt = rebuild_with_extension(index)?;
        let fixes_error = validate_style_block(&rebuilt.css, kind).map_or_else(
            |rebuilt_error| {
                // With several missing `;` forcing one only moves the error to the next one
                rebuilt
                    .source_span(&rebuilt_error, source, template.span)
                    .start
                    > span.start
            },
            |()| true,
        );
        if fixes_error {
            let span = expression.span();
            let expression_source = &source[span.start as usize..span.end as usize];
            return Err(CompilerDiagnostic::error(
                file_path,
                source,
                span,
                format!(
                    "Missing `;` after `${{{expression_source}}}`. CSS interpolations are treated as selectors unless they are followed by `;`, so use `${{{expression_source}}};` when extending styles."
                ),
            ));
        }
    }
    let message = error.syntax_error.map_or(error.message, |description| {
        let variable_context = context.variable_name.map_or_else(
            || context.tag_type.to_owned(),
            |name| format!("... {name} = {}", context.tag_type),
        );
        format!("Invalid CSS at `{variable_context}`: {description}")
    });
    Err(CompilerDiagnostic::error(file_path, source, span, message))
}
