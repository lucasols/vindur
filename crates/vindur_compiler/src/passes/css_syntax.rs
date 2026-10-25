use crate::CompilerDiagnostic;
use oxc_css_parser::{
    Allocator, ParserBuilder, ParserOptions, Syntax,
    ast::{
        AtRule, AtRulePrelude, ComponentValue, ContainerCondition, ContainerConditionKind,
        Declaration, ImportPrelude, ImportPreludeSupportsKind, InterpolableIdent,
        QueryInParensKind, SimpleBlock, Statement, StyleCondition, StyleConditionKind,
        StyleInParensKind, StyleQuery, Stylesheet, SupportsCondition, SupportsConditionKind,
        SupportsInParensKind,
    },
    error::Error,
    token::TokenData,
};

use super::css::reject_misplaced_layers;

/// A CSS problem found while parsing a style block, `start` and `end` are byte offsets into the
/// parsed CSS
pub(crate) struct CssError {
    pub message: String,
    /// The parser error description, set only for syntax errors
    pub syntax_error: Option<String>,
    pub start: usize,
    pub end: usize,
}

impl CssError {
    pub(crate) fn new(message: String, start: usize, end: usize) -> Self {
        Self {
            message,
            syntax_error: None,
            start,
            end,
        }
    }

    fn shifted(self, offset: usize, len: usize) -> Self {
        let start = self.start.saturating_sub(offset).min(len);
        Self {
            start,
            end: self.end.saturating_sub(offset).clamp(start, len),
            ..self
        }
    }

    fn from_parser(error: &Error) -> Self {
        Self::syntax(error.kind.to_string(), error.span.start, error.span.end)
    }

    fn syntax(description: String, start: usize, end: usize) -> Self {
        Self {
            message: format!("Invalid CSS: {description}"),
            syntax_error: Some(description),
            start,
            end,
        }
    }
}

/// Where a style block is used. Keyframes contents are parsed as the block of a `@keyframes` rule,
/// so keyframe selectors like `entry 0%` are understood
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum BlockKind {
    Style,
    Global,
    Keyframes,
}

impl BlockKind {
    pub(crate) fn from_tag_type(tag_type: &str) -> Self {
        match tag_type {
            "keyframes" => Self::Keyframes,
            "createGlobalStyle" => Self::Global,
            _ => Self::Style,
        }
    }
}

const KEYFRAMES_WRAPPER_START: &str = "@keyframes a{";

/// Parses the contents of a style block (what goes between `{` and `}`), the root accepts
/// declarations, nested rules and at-rules
pub(crate) fn parse_style_block<'a>(
    allocator: &'a Allocator,
    css: &'a str,
) -> Result<Stylesheet<'a>, CssError> {
    let stylesheet = parse_source(allocator, css)?;
    validate_statements(&stylesheet.statements)?;
    Ok(stylesheet)
}

fn parse_source<'a>(allocator: &'a Allocator, source: &'a str) -> Result<Stylesheet<'a>, CssError> {
    let mut parser = ParserBuilder::new(allocator, source)
        .syntax(Syntax::Css)
        .options(ParserOptions {
            block_contents: true,
            ..ParserOptions::default()
        })
        .build();
    let stylesheet = parser
        .parse::<Stylesheet>()
        .map_err(|error| CssError::from_parser(&error))?;
    if let Some(error) = parser.recoverable_errors().first() {
        return Err(CssError::from_parser(error));
    }
    Ok(stylesheet)
}

/// Parses a style block of any kind and calls `visit` with its statements, the parsed source and
/// the offset of the CSS in that source. Errors use source offsets and are mapped back to the CSS
fn with_style_block<T>(
    css: &str,
    kind: BlockKind,
    visit: impl FnOnce(&[Statement<'_>], &str, usize) -> Result<T, CssError>,
) -> Result<T, CssError> {
    let wrapped;
    let (source, offset) = if kind == BlockKind::Keyframes {
        wrapped = format!("{KEYFRAMES_WRAPPER_START}{css}}}");
        (wrapped.as_str(), KEYFRAMES_WRAPPER_START.len())
    } else {
        (css, 0)
    };
    let allocator = Allocator::default();
    parse_source(&allocator, source)
        .and_then(|stylesheet| {
            let statements = block_statements(&stylesheet.statements, kind, source.len())?;
            validate_statements(statements)?;
            visit(statements, source, offset)
        })
        .map_err(|error| error.shifted(offset, css.len()))
}

/// The keyframes wrapper must hold the whole source, otherwise the CSS closed it with a `}`
fn block_statements<'s, 'a>(
    statements: &'s [Statement<'a>],
    kind: BlockKind,
    source_len: usize,
) -> Result<&'s [Statement<'a>], CssError> {
    if kind != BlockKind::Keyframes {
        return Ok(statements);
    }
    match statements {
        [
            Statement::AtRule(AtRule {
                block: Some(block), ..
            }),
        ] if block.span.end == source_len => Ok(&block.statements),
        [
            Statement::AtRule(AtRule {
                block: Some(block), ..
            }),
            ..,
        ] => Err(CssError::syntax(
            "unexpected `}`".to_owned(),
            block.span.end.saturating_sub(1),
            block.span.end,
        )),
        _ => Err(CssError::syntax("unexpected `}`".to_owned(), 0, source_len)),
    }
}

/// Fails when the style block is invalid CSS, or uses scoped variables or `layer()` where they
/// are not supported
pub(crate) fn validate_style_block(css: &str, kind: BlockKind) -> Result<(), CssError> {
    with_style_block(css, kind, |statements, source, offset| {
        reject_misplaced_layers(source, statements, kind)?;
        collect_scoped_idents(statements, source, offset).map(|_| ())
    })
}

/// The CSS dialect also accepts postcss-only statements like `$var: value;`, reject them
fn validate_statements(statements: &[Statement<'_>]) -> Result<(), CssError> {
    for statement in statements {
        match statement {
            Statement::Declaration(_) => {}
            Statement::QualifiedRule(rule) => validate_statements(&rule.block.statements)?,
            Statement::UnknownQualifiedRule(rule) => {
                validate_statements(&rule.block.statements)?;
            }
            Statement::KeyframeBlock(block) => validate_statements(&block.block.statements)?,
            Statement::AtRule(rule) => {
                if let Some(block) = &rule.block {
                    validate_statements(&block.statements)?;
                }
            }
            Statement::PostcssSimpleVarDeclaration(declaration) => {
                return Err(CssError::new(
                    "Invalid CSS: `$` variables are not supported, use scoped CSS variables (`---name`) instead"
                        .to_owned(),
                    declaration.span.start,
                    declaration.span.end,
                ));
            }
            statement => {
                let span = statement_span(statement);
                return Err(CssError::new(
                    "Invalid CSS: unsupported statement".to_owned(),
                    span.start,
                    span.end,
                ));
            }
        }
    }
    Ok(())
}

fn statement_span(statement: &Statement<'_>) -> oxc_css_parser::Span {
    match statement {
        Statement::AtRule(rule) => rule.span,
        Statement::Declaration(declaration) => declaration.span,
        Statement::KeyframeBlock(block) => block.span,
        Statement::LessConditionalQualifiedRule(rule) => rule.span,
        Statement::LessExtendRule(rule) => rule.span,
        Statement::LessFunctionCall(function) => function.span,
        Statement::LessMixinCall(call) => call.span,
        Statement::LessMixinDefinition(definition) => definition.span,
        Statement::LessVariableCall(call) => call.span,
        Statement::LessVariableDeclaration(declaration) => declaration.span,
        Statement::Placeholder(placeholder) => placeholder.span,
        Statement::PostcssSimpleVarDeclaration(declaration) => declaration.span,
        Statement::QualifiedRule(rule) => rule.span,
        Statement::SassIfAtRule(rule) => rule.span,
        Statement::SassVariableDeclaration(declaration) => declaration.span,
        Statement::UnknownQualifiedRule(rule) => rule.span,
        Statement::UnknownSassAtRule(rule) => rule.span,
    }
}

/// An identifier starting with `---` (a Vindur scoped CSS variable)
pub(crate) struct ScopedIdent {
    pub start: usize,
    pub end: usize,
    pub is_declaration: bool,
}

const SCOPED_PREFIX: &str = "---";

/// Finds every scoped variable identifier in declaration names, declaration values and supported
/// at-rule preludes, ordered by position. Text inside strings, urls and comments is ignored
pub(crate) fn scoped_idents(css: &str, kind: BlockKind) -> Result<Vec<ScopedIdent>, CssError> {
    with_style_block(css, kind, collect_scoped_idents)
}

fn collect_scoped_idents(
    statements: &[Statement<'_>],
    source: &str,
    offset: usize,
) -> Result<Vec<ScopedIdent>, CssError> {
    let mut collector = ScopedIdentCollector {
        source,
        offset,
        idents: Vec::new(),
    };
    collector.statements(statements)?;
    collector.idents.sort_by_key(|ident| ident.start);
    Ok(collector.idents)
}

struct ScopedIdentCollector<'a> {
    source: &'a str,
    offset: usize,
    idents: Vec<ScopedIdent>,
}

impl ScopedIdentCollector<'_> {
    fn statements(&mut self, statements: &[Statement<'_>]) -> Result<(), CssError> {
        for statement in statements {
            match statement {
                Statement::Declaration(declaration) => self.declaration(declaration, true),
                Statement::QualifiedRule(rule) => self.block(&rule.block)?,
                Statement::UnknownQualifiedRule(rule) => self.block(&rule.block)?,
                Statement::KeyframeBlock(block) => self.block(&block.block)?,
                Statement::AtRule(rule) => self.at_rule(rule)?,
                _ => {}
            }
        }
        Ok(())
    }

    fn block(&mut self, block: &SimpleBlock<'_>) -> Result<(), CssError> {
        self.statements(&block.statements)
    }

    fn at_rule(&mut self, rule: &AtRule<'_>) -> Result<(), CssError> {
        match &rule.prelude {
            Some(AtRulePrelude::Property(ident)) => self.ident(ident),
            Some(AtRulePrelude::Container(prelude)) => {
                if let Some(name) = &prelude.name {
                    self.ident(name);
                }
                if let Some(condition) = &prelude.condition {
                    self.container_condition(rule, condition)?;
                }
            }
            Some(AtRulePrelude::Supports(condition)) => self.supports_condition(rule, condition)?,
            Some(AtRulePrelude::Import(prelude)) => self.import(rule, prelude)?,
            Some(prelude) => self.reject_scoped(rule, *prelude.span())?,
            None => {}
        }
        if let Some(block) = &rule.block {
            self.block(block)?;
        }
        Ok(())
    }

    fn container_condition(
        &mut self,
        rule: &AtRule<'_>,
        condition: &ContainerCondition<'_>,
    ) -> Result<(), CssError> {
        for kind in &condition.conditions {
            let query = match kind {
                ContainerConditionKind::QueryInParens(query) => query,
                ContainerConditionKind::And(and) => &and.query_in_parens,
                ContainerConditionKind::Or(or) => &or.query_in_parens,
                ContainerConditionKind::Not(not) => &not.query_in_parens,
            };
            match &query.kind {
                QueryInParensKind::ContainerCondition(condition) => {
                    self.container_condition(rule, condition)?;
                }
                QueryInParensKind::StyleQuery(StyleQuery::Condition(condition)) => {
                    self.style_condition(condition);
                }
                QueryInParensKind::StyleQuery(StyleQuery::Feature(declaration)) => {
                    self.declaration(declaration, false);
                }
                QueryInParensKind::StyleQuery(StyleQuery::FeatureName(ident)) => self.ident(ident),
                _ => self.reject_scoped(rule, query.span)?,
            }
        }
        Ok(())
    }

    fn style_condition(&mut self, condition: &StyleCondition<'_>) {
        for kind in &condition.conditions {
            let style = match kind {
                StyleConditionKind::StyleInParens(style) => style,
                StyleConditionKind::And(and) => &and.style_in_parens,
                StyleConditionKind::Or(or) => &or.style_in_parens,
                StyleConditionKind::Not(not) => &not.style_in_parens,
            };
            match &style.kind {
                StyleInParensKind::Condition(condition) => self.style_condition(condition),
                StyleInParensKind::Feature(declaration) => self.declaration(declaration, false),
            }
        }
    }

    fn supports_condition(
        &mut self,
        rule: &AtRule<'_>,
        condition: &SupportsCondition<'_>,
    ) -> Result<(), CssError> {
        for kind in &condition.conditions {
            let supports = match kind {
                SupportsConditionKind::SupportsInParens(supports) => supports,
                SupportsConditionKind::And(and) => &and.condition,
                SupportsConditionKind::Or(or) => &or.condition,
                SupportsConditionKind::Not(not) => &not.condition,
            };
            match &supports.kind {
                SupportsInParensKind::SupportsCondition(condition) => {
                    self.supports_condition(rule, condition)?;
                }
                SupportsInParensKind::Feature(feature) => self.declaration(&feature.decl, false),
                _ => self.reject_scoped(rule, supports.span)?,
            }
        }
        Ok(())
    }

    fn import(&mut self, rule: &AtRule<'_>, prelude: &ImportPrelude<'_>) -> Result<(), CssError> {
        if let Some(layer) = &prelude.layer {
            self.reject_scoped(rule, *layer.span())?;
        }
        match prelude.supports.as_ref().map(|supports| &supports.kind) {
            Some(ImportPreludeSupportsKind::SupportsCondition(condition)) => {
                self.supports_condition(rule, condition)?;
            }
            Some(ImportPreludeSupportsKind::Declaration(declaration)) => {
                self.declaration(declaration, false);
            }
            None => {}
        }
        if let Some(media) = &prelude.media {
            self.reject_scoped(rule, media.span)?;
        }
        if let Some(modifiers) = &prelude.modifiers {
            self.reject_scoped(rule, modifiers.span)?;
        }
        Ok(())
    }

    /// Scoped variables are only rewritten in the preludes the collector understands
    fn reject_scoped(&self, rule: &AtRule<'_>, span: oxc_css_parser::Span) -> Result<(), CssError> {
        if self.source[span.start..span.end].contains(SCOPED_PREFIX) {
            return Err(CssError::new(
                format!(
                    "Scoped CSS variables are not supported in `@{}` rule conditions",
                    rule.name.raw
                ),
                span.start,
                span.end,
            ));
        }
        Ok(())
    }

    fn declaration(&mut self, declaration: &Declaration<'_>, is_declaration: bool) {
        if let InterpolableIdent::Literal(name) = &declaration.name {
            self.push(name.span.start, name.span.end, name.raw, is_declaration);
        }
        self.values(&declaration.value);
    }

    fn ident(&mut self, ident: &InterpolableIdent<'_>) {
        if let InterpolableIdent::Literal(ident) = ident {
            self.push(ident.span.start, ident.span.end, ident.raw, false);
        }
    }

    fn values(&mut self, values: &[ComponentValue<'_>]) {
        for value in values {
            self.value(value);
        }
    }

    fn value(&mut self, value: &ComponentValue<'_>) {
        match value {
            ComponentValue::InterpolableIdent(ident) => self.ident(ident),
            ComponentValue::Function(function) => self.values(&function.args),
            ComponentValue::BracketBlock(block) => self.values(&block.value),
            ComponentValue::Calc(calc) => {
                self.value(&calc.left);
                self.value(&calc.right);
            }
            ComponentValue::CalcParenthesized(calc) => self.value(&calc.expr),
            ComponentValue::TokenWithSpan(token) => {
                if matches!(token.token, TokenData::Ident(_)) {
                    self.push(
                        token.span.start,
                        token.span.end,
                        token.raw(self.source),
                        false,
                    );
                }
            }
            _ => {}
        }
    }

    fn push(&mut self, start: usize, end: usize, raw: &str, is_declaration: bool) {
        if raw.len() > SCOPED_PREFIX.len() && raw.starts_with(SCOPED_PREFIX) {
            self.idents.push(ScopedIdent {
                start: start - self.offset,
                end: end - self.offset,
                is_declaration,
            });
        }
    }
}

pub(crate) fn css_error_diagnostic(
    file_path: &str,
    source: &str,
    span: oxc_span::Span,
    error: CssError,
) -> CompilerDiagnostic {
    CompilerDiagnostic::error(file_path, source, span, error.message)
}
