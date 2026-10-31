use oxc_css_parser::{
    ast::{
        AtRule, AtRulePrelude, ComponentValue, ContainerCondition, ContainerConditionKind,
        Declaration, FunctionName, ImportPrelude, ImportPreludeSupportsKind, InterpolableIdent,
        InterpolableStr, KeyframesName, QueryInParensKind, SimpleBlock, Statement, StyleCondition,
        StyleConditionKind, StyleInParensKind, StyleQuery, SupportsCondition,
        SupportsConditionKind, SupportsInParensKind,
    },
    token::{TokenData, TokenWithSpanData},
};

use super::css_syntax::{BlockKind, CssError, with_style_block};
use super::css_tokens::{decode_ident, ident_end, is_ident_char, skipped_token_end};

/// How a scoped variable identifier is used
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum ScopedRole {
    /// The name of a declaration, `---name: value`
    Declaration,
    /// A read of the variable value, `var(---name)` or a container style query
    Read,
    /// An `@property ---name` rule with an `initial-value`, which gives reads a value without a
    /// declaration
    Registration,
    /// Any other dashed identifier, like `container-name: ---name`
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
        quoted_names: None,
        names_fonts: None,
        grid_names: false,
        error: None,
    };
    collector.statements(statements)?;
    if let Some(error) = collector.error {
        return Err(error);
    }
    collector.idents.sort_by_key(|ident| ident.start);
    Ok(collector.idents)
}

struct ScopedIdentCollector<'a> {
    source: &'a str,
    offset: usize,
    idents: Vec<ScopedIdent>,
    /// How strings in the current declaration name things
    quoted_names: Option<QuotedNames>,
    /// The font property whose names are font families in the current declaration
    names_fonts: Option<FontProperty>,
    /// Whether names are grid line or area names, like in `[---main-start]` or `grid-area: ---main`
    grid_names: bool,
    /// The first unsupported scoped name
    error: Option<CssError>,
}

impl ScopedIdentCollector<'_> {
    fn statements(&mut self, statements: &[Statement<'_>]) -> Result<(), CssError> {
        for statement in statements {
            match statement {
                Statement::Declaration(declaration) => {
                    self.declaration(declaration, ScopedRole::Declaration);
                }
                Statement::QualifiedRule(rule) => {
                    self.selector(rule.selector.span);
                    self.block(&rule.block)?;
                }
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
            Some(AtRulePrelude::Property(ident)) => {
                let role = if has_initial_value(rule) {
                    ScopedRole::Registration
                } else {
                    ScopedRole::Name
                };
                self.ident(ident, role);
            }
            Some(
                AtRulePrelude::PositionTry(ident)
                | AtRulePrelude::FontPaletteValues(ident)
                | AtRulePrelude::ScrollTimeline(ident)
                | AtRulePrelude::CounterStyle(ident)
                | AtRulePrelude::Keyframes(KeyframesName::Ident(ident)),
            ) => self.ident(ident, ScopedRole::Name),
            // A quoted name is the same name, `@keyframes "---spin"` is used as `---spin`
            Some(AtRulePrelude::Keyframes(KeyframesName::Str(InterpolableStr::Literal(name)))) => {
                self.quoted_name(name.span);
            }
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
        let text = &self.source[span.start..span.end];
        // Font family names can be quoted, other strings in preludes are text
        let names_fonts = rule.name.name.eq_ignore_ascii_case("font-feature-values");
        if has_scoped_ident(text) || (names_fonts && has_quoted_scoped_name(text)) {
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

    /// Selectors can name scoped variables, like `::view-transition-old(---card)`. Other names in
    /// selectors, like `.---card`, come from the HTML or JS, which is not renamed
    fn selector(&mut self, span: oxc_css_parser::Span) {
        let text = &self.source[span.start..span.end];
        for ScopedIdentRange {
            start,
            end,
            in_view_transition,
        } in scoped_ident_ranges(text)
        {
            if !in_view_transition {
                self.error.get_or_insert_with(|| {
                    CssError::new(
                        format!(
                            "Scoped names in selectors are only supported in `::view-transition-*()` pseudo-elements, `{}` names something in the HTML or JS, which is not renamed, use a plain name",
                            &text[start..end]
                        ),
                        span.start + start,
                        span.start + end,
                    )
                });
                return;
            }
            self.push(
                span.start + start,
                span.start + end,
                &text[start..end],
                ScopedRole::Name,
            );
        }
    }

    fn declaration(&mut self, declaration: &Declaration<'_>, role: ScopedRole) {
        let quoted_names = self.quoted_names;
        let names_fonts = self.names_fonts;
        let grid_names = self.grid_names;
        if let InterpolableIdent::Literal(name) = &declaration.name {
            self.push(name.span.start, name.span.end, name.raw, role);
            self.quoted_names = quoted_names_kind(name.name);
            self.names_fonts = font_property(name.name);
            self.grid_names = is_grid_placement(name.name);
        }
        self.values(&declaration.value);
        self.quoted_names = quoted_names;
        self.names_fonts = names_fonts;
        self.grid_names = grid_names;
    }

    /// Some properties name things with strings, `animation: "---spin" 1s` uses `---spin`, also in
    /// a fallback like `var(--animation, "---spin" 1s)`. Strings of other properties are text
    fn string(&mut self, span: oxc_css_parser::Span) {
        match self.quoted_names {
            Some(QuotedNames::Whole) => self.quoted_name(span),
            // Area names are already local to their grid container, and the lines they imply,
            // like `head-start`, couldn't be renamed to match
            Some(QuotedNames::GridAreas) => self.reject_quoted_scoped_word(span, |name| {
                format!(
                    "Scoped names are not supported in grid area strings, write `{}` as a plain name, area names are already local to their grid container",
                    &name[SCOPED_PREFIX.len()..]
                )
            }),
            // Custom property values can be used by any property, so a quoted scoped name in them
            // can't be told apart from text, also in a grid area string like `"---head ---tail"`
            Some(QuotedNames::Unknown) => self.reject_quoted_scoped_word(span, |name| {
                format!(
                    "Quoted scoped names are not supported in custom properties, write `{name}` without quotes or the string directly in the property that uses it"
                )
            }),
            None => {}
        }
    }

    fn reject_quoted_scoped_word(
        &mut self,
        span: oxc_css_parser::Span,
        message: impl Fn(&str) -> String,
    ) {
        let (_, content) = string_content(self.source, span);
        // Escaped words, like `"\2d --spin"`, are the same names
        let content = if content.contains('\\') {
            decode_ident(content)
        } else {
            content.to_owned()
        };
        if self.error.is_none()
            // Grid area cells are also separated by `.` null cells, like `"---head...side"`
            && let Some(name) = content
                .split(|character: char| character.is_whitespace() || character == '.')
                .find(|word| is_scoped_name(word))
        {
            self.error = Some(CssError::new(message(name), span.start, span.end));
        }
    }

    /// A string that is a whole scoped name, like `"---spin"`, is that name, also escaped, like
    /// `"\2d --spin"`, which would not match the renamed name
    fn quoted_name(&mut self, span: oxc_css_parser::Span) {
        let (content_start, content) = string_content(self.source, span);
        if is_scoped_name(content) {
            self.push(
                content_start,
                content_start + content.len(),
                content,
                ScopedRole::Name,
            );
        } else if content.contains('\\')
            && is_scoped_name(&decode_ident(content))
            && self.error.is_none()
        {
            self.error = Some(CssError::new(
                format!("Scoped name `{content}` can't contain escapes, write it without them"),
                span.start,
                span.end,
            ));
        }
    }

    fn ident(&mut self, ident: &InterpolableIdent<'_>, role: ScopedRole) {
        if let InterpolableIdent::Literal(ident) = ident {
            self.push(ident.span.start, ident.span.end, ident.raw, role);
        }
    }

    fn values(&mut self, values: &[ComponentValue<'_>]) {
        if let Some(property) = self.names_fonts {
            self.reject_multiword_scoped_family(values, property);
        }
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
                // `style(---name: value)` in `if()` reads the variable, like a container style query
                Some((variable, rest))
                    if is_function_named(&function.name, "var")
                        || is_function_named(&function.name, "style") =>
                {
                    self.value(variable, ScopedRole::Read);
                    // A `style()` value is compared with a custom property's value
                    let quoted_names = self.quoted_names;
                    let names_fonts = self.names_fonts;
                    if is_function_named(&function.name, "style") {
                        self.quoted_names = Some(QuotedNames::Unknown);
                        self.names_fonts = None;
                    }
                    self.values(rest);
                    self.quoted_names = quoted_names;
                    self.names_fonts = names_fonts;
                }
                _ => self.values(&function.args),
            },
            // Brackets in values hold grid line names, like `[---main-start]`
            ComponentValue::BracketBlock(block) => {
                let grid_names = std::mem::replace(&mut self.grid_names, true);
                self.values(&block.value);
                self.grid_names = grid_names;
            }
            ComponentValue::Calc(calc) => {
                self.value(&calc.left, ScopedRole::Name);
                self.value(&calc.right, ScopedRole::Name);
            }
            ComponentValue::CalcParenthesized(calc) => self.value(&calc.expr, ScopedRole::Name),
            ComponentValue::InterpolableStr(InterpolableStr::Literal(string)) => {
                self.string(string.span);
            }
            ComponentValue::TokenWithSpan(token) => match token.token {
                TokenData::Ident(_) => self.push(
                    token.span.start,
                    token.span.end,
                    token.raw(self.source),
                    role,
                ),
                TokenData::Str(_) => self.string(token.span),
                _ => {}
            },
            _ => {}
        }
    }

    /// An unquoted family name can be several words, like `---brand sans`, which would be renamed
    /// differently than the quoted `"---brand sans"`
    /// In the `font` shorthand the family comes last, after the size, like `bold medium ---brand`,
    /// so only words after a scoped name are part of its family there
    fn reject_multiword_scoped_family(
        &mut self,
        values: &[ComponentValue<'_>],
        property: FontProperty,
    ) {
        let ident_span = |value: &ComponentValue<'_>| match value {
            ComponentValue::InterpolableIdent(InterpolableIdent::Literal(ident)) => {
                Some((ident.span.start, ident.span.end))
            }
            ComponentValue::TokenWithSpan(token) if matches!(token.token, TokenData::Ident(_)) => {
                Some((token.span.start, token.span.end))
            }
            _ => None,
        };
        for pair in values.windows(2) {
            let (Some(first), Some(second)) = (ident_span(&pair[0]), ident_span(&pair[1])) else {
                continue;
            };
            let words = match property {
                FontProperty::Shorthand => &[first][..],
                FontProperty::Family => &[first, second][..],
            };
            if let Some(&(start, end)) = words
                .iter()
                .find(|(start, end)| is_scoped_name(&self.source[*start..*end]))
                && self.error.is_none()
            {
                self.error = Some(CssError::new(
                    format!(
                        "Scoped font family name `{}` must be a single word, family names of several words are not renamed as one name",
                        &self.source[start..end]
                    ),
                    start,
                    end,
                ));
            }
        }
    }

    fn push(&mut self, start: usize, end: usize, raw: &str, role: ScopedRole) {
        // An escaped prefix, like `\2d --foo`, is the scoped name `---foo` too
        if raw.contains('\\')
            && !raw.starts_with(SCOPED_PREFIX)
            && decode_ident(raw).starts_with(SCOPED_PREFIX)
            && self.error.is_none()
        {
            self.error = Some(CssError::new(
                format!("Scoped name `{raw}` can't contain escapes, write it without them"),
                start,
                end,
            ));
        }
        if raw.len() > SCOPED_PREFIX.len() && raw.starts_with(SCOPED_PREFIX) {
            // Lines named by an area, like `---main-start` for `---main`, couldn't be renamed to match
            if self.grid_names && role == ScopedRole::Name && self.error.is_none() {
                self.error = Some(CssError::new(
                    format!(
                        "Scoped names are not supported in grid line and area names, write `{}` as a plain name, they are already local to their grid container",
                        &raw[SCOPED_PREFIX.len()..]
                    ),
                    start,
                    end,
                ));
            }
            // Names are matched as written, `---sp\69n` and `---spin` would get different hashes
            if raw.contains('\\') && self.error.is_none() {
                self.error = Some(CssError::new(
                    format!("Scoped name `{raw}` can't contain escapes, write it without them"),
                    start,
                    end,
                ));
            }
            // Font family names match case-insensitively, `---Brand` and `---brand` would get
            // different hashes. Non-ASCII letters have case variants too, so they aren't allowed
            if self.names_fonts.is_some()
                && role == ScopedRole::Name
                && raw
                    .chars()
                    .any(|character| !character.is_ascii() || character.is_ascii_uppercase())
                && self.error.is_none()
            {
                let message = if raw.is_ascii() {
                    format!(
                        "Scoped font family name `{raw}` must be lowercase, as font family names match case-insensitively, use `{}`",
                        raw.to_ascii_lowercase()
                    )
                } else {
                    format!(
                        "Scoped font family name `{raw}` must only use lowercase ASCII letters, as font family names match case-insensitively"
                    )
                };
                self.error = Some(CssError::new(message, start, end));
            }
            self.idents.push(ScopedIdent {
                start: start - self.offset,
                end: end - self.offset,
                role,
            });
        }
    }
}

fn string_content(source: &str, span: oxc_css_parser::Span) -> (usize, &str) {
    let quote_len = 1;
    let content_start = span.start + quote_len;
    let content_end = span.end.saturating_sub(quote_len).max(content_start);
    (content_start, &source[content_start..content_end])
}

#[derive(Clone, Copy)]
enum QuotedNames {
    /// The whole string is one name
    Whole,
    GridAreas,
    /// Custom properties, strings can be names or text depending on where they are used
    Unknown,
}

fn quoted_names_kind(property: &str) -> Option<QuotedNames> {
    // `@property` gives its `initial-value` to the custom property
    if property.starts_with("--") || property.eq_ignore_ascii_case("initial-value") {
        return Some(QuotedNames::Unknown);
    }
    let property = ["-webkit-", "-moz-", "-o-", "-ms-"]
        .iter()
        .find_map(|prefix| {
            property
                .get(..prefix.len())
                .filter(|start| start.eq_ignore_ascii_case(prefix))
                .map(|_| &property[prefix.len()..])
        })
        .unwrap_or(property);
    let is = |name: &str| property.eq_ignore_ascii_case(name);
    if is("animation") || is("animation-name") || is("font") || is("font-family") {
        Some(QuotedNames::Whole)
    } else if is("grid-template-areas") || is("grid-template") || is("grid") {
        Some(QuotedNames::GridAreas)
    } else {
        None
    }
}

#[derive(Clone, Copy)]
enum FontProperty {
    /// `font`, whose family comes after other values
    Shorthand,
    /// `font-family`
    Family,
}

/// Properties that place items by grid line or area names
fn is_grid_placement(property: &str) -> bool {
    [
        "grid-area",
        "grid-row",
        "grid-column",
        "grid-row-start",
        "grid-row-end",
        "grid-column-start",
        "grid-column-end",
    ]
    .iter()
    .any(|name| property.eq_ignore_ascii_case(name))
}

fn font_property(property: &str) -> Option<FontProperty> {
    if property.eq_ignore_ascii_case("font") {
        Some(FontProperty::Shorthand)
    } else if property.eq_ignore_ascii_case("font-family") {
        Some(FontProperty::Family)
    } else {
        None
    }
}

fn has_initial_value(rule: &AtRule<'_>) -> bool {
    rule.block.as_ref().is_some_and(|block| {
        block.statements.iter().any(|statement| {
            matches!(
                statement,
                Statement::Declaration(Declaration { name: InterpolableIdent::Literal(name), .. })
                    if name.name.eq_ignore_ascii_case("initial-value")
            )
        })
    })
}

fn is_function_named(name: &FunctionName<'_>, expected: &str) -> bool {
    matches!(
        name,
        FunctionName::Ident(InterpolableIdent::Literal(ident)) if ident.name.eq_ignore_ascii_case(expected)
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
    !scoped_ident_ranges(text).is_empty()
}

/// A whole scoped name, like `---spin`
fn is_scoped_name(text: &str) -> bool {
    text.len() > SCOPED_PREFIX.len()
        && text.starts_with(SCOPED_PREFIX)
        && ident_end(text, 0) == text.len()
}

/// Whether the text has a string that is a whole scoped name, like `"---brand"`
fn has_quoted_scoped_name(text: &str) -> bool {
    let mut index = 0;
    while let Some(character) = text[index..].chars().next() {
        if let Some(end) = skipped_token_end(text, index) {
            if matches!(character, '"' | '\'')
                && let Some(content) = text.get(index + 1..end.saturating_sub(1))
                // Escaped names, like `"\2d --brand"`, are the same names
                && (is_scoped_name(content)
                    || (content.contains('\\') && is_scoped_name(&decode_ident(content))))
            {
                return true;
            }
            index = end;
            continue;
        }
        index += character.len_utf8();
    }
    false
}

struct ScopedIdentRange {
    start: usize,
    end: usize,
    /// In the parentheses of a view transition pseudo-element, like `---card` in
    /// `::view-transition-old(---card)` or `::view-transition-group(*.---cards)`
    in_view_transition: bool,
}

/// The identifiers starting with `---`. Comments, strings, urls and unquoted attribute selector
/// values, like `[data-state=---open]`, are ignored
fn scoped_ident_ranges(text: &str) -> Vec<ScopedIdentRange> {
    let mut ranges = Vec::new();
    let mut index = 0;
    let mut in_attribute = false;
    let mut attribute_value = false;
    let mut depth = 0usize;
    // The depth of the open parentheses of a view transition pseudo-element
    let mut view_transition_depth = None;
    while let Some(character) = text[index..].chars().next() {
        // Escapes are part of identifiers, `\61 ---a` is the single identifier `a---a`
        if character != '\\'
            && let Some(end) = skipped_token_end(text, index)
        {
            index = end;
            continue;
        }
        if is_ident_char(character) {
            let end = ident_end(text, index);
            let ident = &text[index..end];
            // An escaped prefix, like `\2d --card`, is a scoped name too, rejected where it's used
            if !attribute_value
                && ident.len() > SCOPED_PREFIX.len()
                && (ident.starts_with(SCOPED_PREFIX)
                    || (ident.contains('\\') && decode_ident(ident).starts_with(SCOPED_PREFIX)))
            {
                ranges.push(ScopedIdentRange {
                    start: index,
                    end,
                    in_view_transition: view_transition_depth.is_some(),
                });
            }
            if view_transition_depth.is_none()
                && text[..index].ends_with("::")
                && ident
                    .get(..16)
                    .is_some_and(|name| name.eq_ignore_ascii_case("view-transition-"))
                && text[end..].starts_with('(')
            {
                view_transition_depth = Some(depth + 1);
            }
            index = end;
            continue;
        }
        match character {
            '(' => depth += 1,
            ')' => {
                if view_transition_depth == Some(depth) {
                    view_transition_depth = None;
                }
                depth = depth.saturating_sub(1);
            }
            '[' => in_attribute = true,
            ']' => {
                in_attribute = false;
                attribute_value = false;
            }
            '=' if in_attribute => attribute_value = true,
            _ => {}
        }
        index += character.len_utf8();
    }
    ranges
}
