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

    /// Maps a CSS error to the source and whether it starts in an interpolated value, a zero width
    /// error is widened to the next character and an error at the end of the CSS points to the
    /// closing backtick
    fn source_span(
        &self,
        error: &CssError,
        source: &str,
        template: &TemplateLiteral<'_>,
    ) -> (Span, bool) {
        if error.start >= self.css.len() {
            return (
                Span::new(template.span.end.saturating_sub(1), template.span.end),
                false,
            );
        }
        self.mapped(error, source)
            .map_or((template.span, false), |(span, segment)| {
                (
                    span,
                    matches!(segment.origin, SegmentOrigin::Interpolation(_)),
                )
            })
    }

    /// Source position of a CSS error, `None` when it can't be mapped to the source
    fn error_position(
        &self,
        error: &CssError,
        source: &str,
        template: &TemplateLiteral<'_>,
    ) -> Option<u32> {
        if error.start >= self.css.len() {
            return Some(template.span.end);
        }
        self.mapped(error, source).map(|(span, _)| span.start)
    }

    fn mapped(&self, error: &CssError, source: &str) -> Option<(Span, &TemplateSegment)> {
        let end = error.end.max(error.start + 1).min(self.css.len());
        template_source_span(&self.css, source, &self.segments, error.start..end)
    }
}

/// Fails with a source located error when the evaluated CSS is invalid. When treating CSS class
/// interpolations as style extensions fixes the CSS, or moves the error past them, the error points
/// to the first missing `;`
pub(crate) fn validate_template_css(
    evaluated: &EvaluatedTemplate,
    template: &TemplateLiteral<'_>,
    file_path: &str,
    source: &str,
    context: &TemplateContext<'_>,
    rebuild_with_extensions: impl Fn(&[usize]) -> Result<EvaluatedTemplate, CompilerDiagnostic>,
) -> Result<(), CompilerDiagnostic> {
    let kind = BlockKind::from_tag_type(context.tag_type);
    let Err(error) = validate_style_block(&evaluated.css, kind) else {
        return Ok(());
    };
    let position = evaluated.error_position(&error, source, template);
    let fixes_error = |forced: &[usize]| -> Result<bool, CompilerDiagnostic> {
        let rebuilt = rebuild_with_extensions(forced)?;
        Ok(match validate_style_block(&rebuilt.css, kind) {
            Ok(()) => true,
            // With several missing `;` forcing one only moves the error to the next one
            Err(rebuilt_error) => position
                .zip(rebuilt.error_position(&rebuilt_error, source, template))
                .is_some_and(|(position, rebuilt_position)| rebuilt_position > position),
        })
    };
    let candidates = evaluated
        .selector_classes
        .iter()
        .copied()
        .filter(|&index| {
            template.expressions.get(index).is_some_and(|expression| {
                position.is_none_or(|position| expression.span().start < position)
            })
        })
        .collect::<Vec<_>>();
    if let Some(index) = missing_extension(&candidates, fixes_error)?
        && let Some(expression) = template.expressions.get(index)
    {
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
    let (span, in_interpolation) = evaluated.source_span(&error, source, template);
    let is_syntax_error = error.syntax_error.is_some();
    let is_line_comment = evaluated
        .css
        .get(error.start..)
        .is_some_and(|rest| rest.starts_with("//"));
    let message = error.syntax_error.map_or(error.message, |description| {
        let variable_context = context.variable_name.map_or_else(
            || context.tag_type.to_owned(),
            |name| format!("... {name} = {}", context.tag_type),
        );
        let description = if is_line_comment {
            "`//` comments are not supported in CSS, use `/* ... */`".to_owned()
        } else {
            description
        };
        format!("Invalid CSS at `{variable_context}`: {description}")
    });
    // Syntax errors found in a static value point to the interpolation, not to the CSS token
    let message = if in_interpolation && is_syntax_error {
        format!("{message} (found in the interpolated value)")
    } else {
        message
    };
    Err(CompilerDiagnostic::error(file_path, source, span, message))
}

/// Finds the first CSS class interpolation missing its `;`. Consecutive missing `;` only fix the
/// CSS together, so when no single one does, all are forced and the ones not needed are dropped
fn missing_extension(
    candidates: &[usize],
    fixes_error: impl Fn(&[usize]) -> Result<bool, CompilerDiagnostic>,
) -> Result<Option<usize>, CompilerDiagnostic> {
    for &index in candidates {
        if fixes_error(&[index])? {
            return Ok(Some(index));
        }
    }
    if candidates.len() < 2 || !fixes_error(candidates)? {
        return Ok(None);
    }
    let mut forced = candidates.to_vec();
    for &index in candidates {
        let without = forced
            .iter()
            .copied()
            .filter(|&forced_index| forced_index != index)
            .collect::<Vec<_>>();
        if fixes_error(&without)? {
            forced = without;
        }
    }
    Ok(forced.first().copied())
}
