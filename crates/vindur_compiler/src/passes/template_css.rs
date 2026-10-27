use oxc_ast::ast::{TemplateElement, TemplateLiteral};
use oxc_span::{GetSpan, Span};

use crate::CompilerDiagnostic;

use super::css::layer_markers_in_text;
use super::css_syntax::{BlockKind, CssError, validate_style_block};
use super::css_tokens::is_inside_block;
use super::static_value::TemplateContext;
use super::template_location::{SegmentOrigin, TemplateSegment, template_source_span};

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

    /// Whether the interpolation is inside the block opened by a `{` at `brace`, the parser reports
    /// some errors in a rule at the `{` that opens it
    fn is_in_block_opened_at(&self, brace: usize, expression: Span) -> bool {
        let Some(interpolation_start) = self.segments.iter().find_map(|segment| {
            matches!(segment.origin, SegmentOrigin::Interpolation(span) if span == expression)
                .then_some(segment.range.start)
        }) else {
            return false;
        };
        is_inside_block(&self.css, brace, interpolation_start)
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
    let validate = |css: &str| validate_style_block(css, kind);
    let Err(error) = validate(&evaluated.css) else {
        return reject_layers_in_text(evaluated, file_path, source);
    };
    let position = evaluated.error_position(&error, source, template);
    // Forcing a selector interpolation always moves an error found before it, so moving the error
    // only counts when the error is about the interpolation
    let is_related = |index: usize| {
        template.expressions.get(index).is_some_and(|expression| {
            let span = expression.span();
            position.is_some_and(|position| position >= span.start)
                || evaluated.is_in_block_opened_at(error.start, span)
        })
    };
    let fixes_error = |forced: &[usize]| -> Result<bool, CompilerDiagnostic> {
        let rebuilt = rebuild_with_extensions(forced)?;
        Ok(match validate(&rebuilt.css) {
            Ok(()) => true,
            // With several missing `;` forcing one only moves the error to the next one
            Err(rebuilt_error) => {
                forced.iter().any(|&index| is_related(index))
                    && position
                        .zip(rebuilt.error_position(&rebuilt_error, source, template))
                        .is_some_and(|(position, rebuilt_position)| rebuilt_position > position)
            }
        })
    };
    // The parser can report the error before the interpolation, at the `{` of the rule holding it,
    // so every candidate is tried, `fixes_error` rejects the ones that don't fix the error
    if let Some(index) = missing_extension(&evaluated.selector_classes, fixes_error)?
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
    let message = error.syntax_error.map_or(error.message, |description| {
        let variable_context = context.variable_name.map_or_else(
            || context.tag_type.to_owned(),
            |name| format!("... {name} = {}", context.tag_type),
        );
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

/// The parser accepts a `layer()` inside a string or comment, where it is not a rule selector
fn reject_layers_in_text(
    evaluated: &EvaluatedTemplate,
    file_path: &str,
    source: &str,
) -> Result<(), CompilerDiagnostic> {
    for start in layer_markers_in_text(&evaluated.css) {
        if let Some(TemplateSegment {
            origin: SegmentOrigin::Interpolation(span),
            ..
        }) = evaluated
            .segments
            .iter()
            .find(|segment| segment.range.contains(&start))
        {
            return Err(CompilerDiagnostic::error(
                file_path,
                source,
                *span,
                "layer() can only be used as the selector of a rule, e.g. `${layer('name')} { ... }`"
                    .to_owned(),
            ));
        }
    }
    Ok(())
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
