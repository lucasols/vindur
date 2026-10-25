use oxc_css_parser::{
    ast::{
        AtRule, AtRulePrelude, ComponentValue, ContainerCondition, ContainerConditionKind,
        Declaration, FunctionName, ImportPrelude, ImportPreludeSupportsKind, InterpolableIdent,
        QueryInParensKind, SimpleBlock, Statement, StyleCondition, StyleConditionKind,
        StyleInParensKind, StyleQuery, SupportsCondition, SupportsConditionKind,
        SupportsInParensKind,
    },
    token::{TokenData, TokenWithSpanData},
};

use super::css_syntax::{BlockKind, CssError, with_style_block};
use super::unsupported_css_syntax::{is_ident_char, skipped_token_end};

/// How a scoped variable identifier is used
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum ScopedRole {
    /// The name of a declaration, `---name: value`
    Declaration,
    /// A read of the variable value, `var(---name)` or a container style query
    Read,
    /// Any other dashed identifier, like `@property ---name` or `container-name: ---name`
    Name,
}

/// An identifier starting with `---` (a Vindur scoped CSS variable)
pub(crate) struct ScopedIdent {
    pub start: usize,
    pub end: usize,
    pub role: ScopedRole,
}

const SCOPED_PREFIX: &str = "---";

/// Finds every scoped variable identifier in declaration names, declaration values and supported
/// at-rule preludes, ordered by position. Text inside strings, urls and comments is ignored
pub(crate) fn scoped_idents(css: &str, kind: BlockKind) -> Result<Vec<ScopedIdent>, CssError> {
    with_style_block(css, kind, collect_scoped_idents)
}

pub(super) fn collect_scoped_idents(
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
                Statement::Declaration(declaration) => {
                    self.declaration(declaration, ScopedRole::Declaration);
                }
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
            Some(
                AtRulePrelude::Property(ident)
                | AtRulePrelude::PositionTry(ident)
                | AtRulePrelude::FontPaletteValues(ident)
                | AtRulePrelude::ScrollTimeline(ident),
            ) => self.ident(ident, ScopedRole::Name),
            Some(AtRulePrelude::Container(prelude)) => {
                if let Some(name) = &prelude.name {
                    self.ident(name, ScopedRole::Name);
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
                    self.declaration(declaration, ScopedRole::Read);
                }
                QueryInParensKind::StyleQuery(StyleQuery::FeatureName(ident)) => {
                    self.ident(ident, ScopedRole::Read);
                }
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
                StyleInParensKind::Feature(declaration) => {
                    self.declaration(declaration, ScopedRole::Read);
                }
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
                SupportsInParensKind::Feature(feature) => {
                    self.declaration(&feature.decl, ScopedRole::Name);
                }
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
                self.declaration(declaration, ScopedRole::Name);
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
        if has_scoped_ident(&self.source[span.start..span.end]) {
            return Err(CssError::new(
                format!(
                    "Scoped CSS variables are not supported in `@{}` rule preludes",
                    rule.name.raw
                ),
                span.start,
                span.end,
            ));
        }
        Ok(())
    }

    fn declaration(&mut self, declaration: &Declaration<'_>, role: ScopedRole) {
        if let InterpolableIdent::Literal(name) = &declaration.name {
            self.push(name.span.start, name.span.end, name.raw, role);
        }
        self.values(&declaration.value);
    }

    fn ident(&mut self, ident: &InterpolableIdent<'_>, role: ScopedRole) {
        if let InterpolableIdent::Literal(ident) = ident {
            self.push(ident.span.start, ident.span.end, ident.raw, role);
        }
    }

    fn values(&mut self, values: &[ComponentValue<'_>]) {
        for (index, value) in values.iter().enumerate() {
            let role = match index
                .checked_sub(2)
                .and_then(|start| values.get(start..index))
            {
                Some(
                    [
                        ComponentValue::TokenWithSpan(name),
                        ComponentValue::TokenWithSpan(paren),
                    ],
                ) if is_raw_var_call(name, paren, self.source) => ScopedRole::Read,
                _ => ScopedRole::Name,
            };
            self.value(value, role);
        }
    }

    /// Identifiers in values are names, except the variable a `var()` reads
    fn value(&mut self, value: &ComponentValue<'_>, role: ScopedRole) {
        match value {
            ComponentValue::InterpolableIdent(ident) => self.ident(ident, role),
            ComponentValue::Function(function) => match function.args.split_first() {
                Some((variable, fallback)) if is_var_function(&function.name) => {
                    self.value(variable, ScopedRole::Read);
                    self.values(fallback);
                }
                _ => self.values(&function.args),
            },
            ComponentValue::BracketBlock(block) => self.values(&block.value),
            ComponentValue::Calc(calc) => {
                self.value(&calc.left, ScopedRole::Name);
                self.value(&calc.right, ScopedRole::Name);
            }
            ComponentValue::CalcParenthesized(calc) => self.value(&calc.expr, ScopedRole::Name),
            ComponentValue::TokenWithSpan(token) => {
                if matches!(token.token, TokenData::Ident(_)) {
                    self.push(
                        token.span.start,
                        token.span.end,
                        token.raw(self.source),
                        role,
                    );
                }
            }
            _ => {}
        }
    }

    fn push(&mut self, start: usize, end: usize, raw: &str, role: ScopedRole) {
        if raw.len() > SCOPED_PREFIX.len() && raw.starts_with(SCOPED_PREFIX) {
            self.idents.push(ScopedIdent {
                start: start - self.offset,
                end: end - self.offset,
                role,
            });
        }
    }
}

fn is_var_function(name: &FunctionName<'_>) -> bool {
    matches!(
        name,
        FunctionName::Ident(InterpolableIdent::Literal(ident)) if ident.name.eq_ignore_ascii_case("var")
    )
}

/// Values kept as raw tokens, like custom property values, have `var(` as an identifier followed
/// by a `(`
fn is_raw_var_call(name: &TokenWithSpanData, paren: &TokenWithSpanData, source: &str) -> bool {
    matches!(name.token, TokenData::Ident(_))
        && name.raw(source).eq_ignore_ascii_case("var")
        && matches!(paren.token, TokenData::LParen(_))
        && paren.span.start == name.span.end
}

/// Whether the text has an identifier starting with `---`, comments, strings and urls are ignored
fn has_scoped_ident(text: &str) -> bool {
    let mut index = 0;
    while let Some(character) = text[index..].chars().next() {
        if let Some(end) = skipped_token_end(text, index) {
            index = end;
            continue;
        }
        let rest = &text[index..];
        if rest.starts_with(SCOPED_PREFIX)
            && rest[SCOPED_PREFIX.len()..]
                .chars()
                .next()
                .is_some_and(is_ident_char)
            && !text[..index].chars().next_back().is_some_and(is_ident_char)
        {
            return true;
        }
        index += character.len_utf8();
    }
    false
}
