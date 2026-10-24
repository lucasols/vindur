use crate::CompilerDiagnostic;
use oxc_css_parser::{
    Allocator, ParserBuilder, ParserOptions, Syntax,
    ast::{
        AtRule, AtRulePrelude, ComponentValue, Declaration, InterpolableIdent, SimpleBlock,
        Statement, Stylesheet,
    },
    error::Error,
    token::TokenData,
};

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

    fn from_parser(error: &Error) -> Self {
        let description = error.kind.to_string();
        Self {
            message: format!("Invalid CSS: {description}"),
            syntax_error: Some(description),
            start: error.span.start,
            end: error.span.end,
        }
    }
}

/// Parses the contents of a style block (what goes between `{` and `}`), the root accepts
/// declarations, nested rules and at-rules
pub(crate) fn parse_style_block<'a>(
    allocator: &'a Allocator,
    css: &'a str,
) -> Result<Stylesheet<'a>, CssError> {
    let mut parser = ParserBuilder::new(allocator, css)
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
    validate_statements(&stylesheet.statements)?;
    Ok(stylesheet)
}

pub(crate) fn validate_style_block(css: &str) -> Result<(), CssError> {
    let allocator = Allocator::default();
    parse_style_block(&allocator, css).map(|_| ())
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

/// Finds every scoped variable identifier in declaration names, declaration values and
/// `@property` preludes, ordered by position. Text inside strings, urls and comments is ignored
pub(crate) fn scoped_idents(css: &str) -> Result<Vec<ScopedIdent>, CssError> {
    let allocator = Allocator::default();
    let stylesheet = parse_style_block(&allocator, css)?;
    let mut collector = ScopedIdentCollector {
        css,
        idents: Vec::new(),
    };
    collector.statements(&stylesheet.statements)?;
    collector.idents.sort_by_key(|ident| ident.start);
    Ok(collector.idents)
}

struct ScopedIdentCollector<'a> {
    css: &'a str,
    idents: Vec<ScopedIdent>,
}

impl ScopedIdentCollector<'_> {
    fn statements(&mut self, statements: &[Statement<'_>]) -> Result<(), CssError> {
        for statement in statements {
            match statement {
                Statement::Declaration(declaration) => self.declaration(declaration),
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
            Some(AtRulePrelude::Property(InterpolableIdent::Literal(ident))) => {
                self.push(ident.span.start, ident.span.end, ident.raw, false);
            }
            Some(prelude) => {
                let span = prelude.span();
                if self.css[span.start..span.end].contains(SCOPED_PREFIX) {
                    return Err(CssError::new(
                        format!(
                            "Scoped CSS variables are not supported in `@{}` rule conditions",
                            rule.name.raw
                        ),
                        span.start,
                        span.end,
                    ));
                }
            }
            None => {}
        }
        if let Some(block) = &rule.block {
            self.block(block)?;
        }
        Ok(())
    }

    fn declaration(&mut self, declaration: &Declaration<'_>) {
        if let InterpolableIdent::Literal(name) = &declaration.name {
            self.push(name.span.start, name.span.end, name.raw, true);
        }
        self.values(&declaration.value);
    }

    fn values(&mut self, values: &[ComponentValue<'_>]) {
        for value in values {
            self.value(value);
        }
    }

    fn value(&mut self, value: &ComponentValue<'_>) {
        match value {
            ComponentValue::InterpolableIdent(InterpolableIdent::Literal(ident)) => {
                self.push(ident.span.start, ident.span.end, ident.raw, false);
            }
            ComponentValue::Function(function) => self.values(&function.args),
            ComponentValue::BracketBlock(block) => self.values(&block.value),
            ComponentValue::Calc(calc) => {
                self.value(&calc.left);
                self.value(&calc.right);
            }
            ComponentValue::CalcParenthesized(calc) => self.value(&calc.expr),
            ComponentValue::TokenWithSpan(token) => {
                if matches!(token.token, TokenData::Ident(_)) {
                    self.push(token.span.start, token.span.end, token.raw(self.css), false);
                }
            }
            _ => {}
        }
    }

    fn push(&mut self, start: usize, end: usize, raw: &str, is_declaration: bool) {
        if raw.len() > SCOPED_PREFIX.len() && raw.starts_with(SCOPED_PREFIX) {
            self.idents.push(ScopedIdent {
                start,
                end,
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
