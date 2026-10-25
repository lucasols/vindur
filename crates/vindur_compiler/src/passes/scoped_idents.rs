use oxc_css_parser::{
    ast::{
        AtRule, AtRulePrelude, ComponentValue, ContainerCondition, ContainerConditionKind,
        Declaration, ImportPrelude, ImportPreludeSupportsKind, InterpolableIdent,
        QueryInParensKind, SimpleBlock, Statement, StyleCondition, StyleConditionKind,
        StyleInParensKind, StyleQuery, SupportsCondition, SupportsConditionKind,
        SupportsInParensKind,
    },
    token::TokenData,
};

use super::css_syntax::{BlockKind, CssError, with_style_block};
use super::unsupported_css_syntax::{is_ident_char, skipped_token_end};

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
        if has_scoped_ident(&self.source[span.start..span.end]) {
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
