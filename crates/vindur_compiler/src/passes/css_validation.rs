use oxc_css_parser::{
    ast::{ComponentValue, Declaration, InterpolableIdent, Statement, TokenSeq},
    token::TokenData,
};

use super::css::with_layer_calls;
use super::css_syntax::CssError;
use super::css_tokens::is_ident_char;

/// The CSS dialect also accepts postcss-only syntax like `$var: value;`, `*zoom: 1` or rules
/// without a selector, reject them
pub(super) fn validate_statements(
    statements: &[Statement<'_>],
    source: &str,
) -> Result<(), CssError> {
    for statement in statements {
        match statement {
            Statement::Declaration(declaration) => validate_declaration(declaration, source)?,
            Statement::QualifiedRule(rule) => {
                if rule.selector.selectors.is_empty() {
                    return Err(CssError::syntax(
                        "expected a selector before `{`".to_owned(),
                        rule.block.span.start,
                        rule.block.span.start + 1,
                    ));
                }
                validate_statements(&rule.block.statements, source)?;
            }
            Statement::UnknownQualifiedRule(rule) => {
                return Err(unknown_rule_error(&rule.prelude, source));
            }
            Statement::KeyframeBlock(block) => {
                validate_statements(&block.block.statements, source)?;
            }
            Statement::AtRule(rule) => {
                if let Some(block) = &rule.block {
                    validate_statements(&block.statements, source)?;
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

/// The CSS dialect keeps rules whose prelude is not a selector, like `color: red &:hover { ... }`
/// (a declaration missing its `;` before a nested rule) or `50% { ... }` outside keyframes
fn unknown_rule_error(prelude: &TokenSeq<'_>, source: &str) -> CssError {
    let text = with_layer_calls(
        &source[prelude.span.start..prelude.span.end]
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" "),
    );
    // A declaration starts with a property name followed by `:` and a space, a selector like
    // `&:hover:` has no space after its `:`
    let is_declaration_shaped = text.split_once(':').is_some_and(|(property, rest)| {
        is_property_name(property.trim_end()) && (rest.is_empty() || rest.starts_with(' '))
    });
    let message = if is_declaration_shaped {
        format!("missing `;` before a nested rule, `{text}` is not a valid selector")
    } else {
        format!("`{text}` is not a valid selector")
    };
    CssError::syntax(message, prelude.span.start, prelude.span.end)
}

fn validate_declaration(declaration: &Declaration<'_>, source: &str) -> Result<(), CssError> {
    let InterpolableIdent::Literal(name) = &declaration.name else {
        return Ok(());
    };
    if !is_property_name(name.raw) {
        return Err(CssError::syntax(
            format!(
                "`{}` is not a valid property name, selectors need a `{{ ... }}` block",
                name.raw
            ),
            name.span.start,
            name.span.end,
        ));
    }
    // `color: red\n width: 1px;` is parsed as a single `color` declaration. Custom property values
    // can contain `name:` anywhere, so only scoped variables are checked, and only for a `name:`
    // starting a line outside brackets
    let next_property = if name.name.starts_with("--") {
        if !name.raw.starts_with("---") {
            return Ok(());
        }
        next_property_on_new_line(&declaration.value, source)
    } else {
        declaration
            .value
            .windows(2)
            .position(|pair| is_property_start(pair))
    };
    let Some(index) = next_property else {
        return Ok(());
    };
    // The `;` is missing after the value before the next property name, the error points at that
    // value so it is located where the `;` goes, even when the property comes from an interpolation
    match index
        .checked_sub(1)
        .and_then(|previous| declaration.value.get(previous))
    {
        Some(previous) => {
            let span = previous.span();
            let text = &source[span.start..span.end];
            let message = if text.len() <= 30 && !text.contains('\n') {
                format!("missing `;` after `{text}`")
            } else {
                "missing `;` after this value".to_owned()
            };
            Err(CssError::syntax(message, span.start, span.end))
        }
        None => {
            let span = declaration.value[index].span();
            Err(CssError::syntax(
                format!("missing `;` before `{}`", &source[span.start..span.end]),
                span.start,
                span.end,
            ))
        }
    }
}

fn is_property_start(pair: &[ComponentValue<'_>]) -> bool {
    match pair {
        [
            ComponentValue::TokenWithSpan(ident),
            ComponentValue::TokenWithSpan(colon),
        ] => {
            matches!(ident.token, TokenData::Ident(_)) && matches!(colon.token, TokenData::Colon(_))
        }
        _ => false,
    }
}

/// A `name:` at the top level of a custom property value that starts a new line
fn next_property_on_new_line(values: &[ComponentValue<'_>], source: &str) -> Option<usize> {
    let mut depth = 0usize;
    for (index, value) in values.iter().enumerate() {
        if let ComponentValue::TokenWithSpan(token) = value {
            match token.token {
                TokenData::LParen(_) | TokenData::LBracket(_) | TokenData::LBrace(_) => depth += 1,
                TokenData::RParen(_) | TokenData::RBracket(_) | TokenData::RBrace(_) => {
                    depth = depth.saturating_sub(1);
                }
                _ => {}
            }
        }
        let starts_line = index.checked_sub(1).is_some_and(|previous| {
            source[values[previous].span().end..value.span().start].contains('\n')
        });
        if depth == 0 && starts_line && values.get(index..index + 2).is_some_and(is_property_start)
        {
            return Some(index);
        }
    }
    None
}

pub(super) fn statement_span(statement: &Statement<'_>) -> oxc_css_parser::Span {
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

/// The CSS dialect also accepts postcss property names like `*zoom` or `&`, which usually come
/// from a selector missing its `{ ... }` block
fn is_property_name(name: &str) -> bool {
    let (body, mut needs_name_start) = match name.strip_prefix("--") {
        Some(custom) => (custom, false),
        None => (name.strip_prefix('-').unwrap_or(name), true),
    };
    let mut characters = body.chars().peekable();
    while let Some(character) = characters.next() {
        let is_valid = match character {
            '\\' => skip_escape(&mut characters),
            _ if needs_name_start => {
                character.is_ascii_alphabetic() || character == '_' || !character.is_ascii()
            }
            _ => is_ident_char(character),
        };
        if !is_valid {
            return false;
        }
        needs_name_start = false;
    }
    !needs_name_start
}

/// Skips an escape after its `\`, a hex escape can be followed by one whitespace
fn skip_escape(characters: &mut std::iter::Peekable<std::str::Chars<'_>>) -> bool {
    let Some(escaped) = characters.next() else {
        return false;
    };
    if escaped == '\n' {
        return false;
    }
    if escaped.is_ascii_hexdigit() {
        for _ in 0..5 {
            if characters.next_if(char::is_ascii_hexdigit).is_none() {
                break;
            }
        }
        characters.next_if(|character| character.is_ascii_whitespace());
    }
    true
}

#[cfg(test)]
mod tests {
    use super::super::css_syntax::{BlockKind, validate_style_block};
    fn error(css: &str) -> String {
        match validate_style_block(css, BlockKind::Style) {
            Ok(()) => "ok".to_owned(),
            Err(error) => format!("{} at {}..{}", error.message, error.start, error.end),
        }
    }

    #[test]
    fn rejects_selectors_without_a_block() {
        assert_eq!(
            [
                error("&:hover\ncolor: red;"),
                error("color: red;\n&:focus"),
                error("{ color: blue; }"),
                error("*zoom: 1;"),
            ],
            [
                "Invalid CSS: `&` is not a valid property name, selectors need a `{ ... }` block at 0..1",
                "Invalid CSS: `&` is not a valid property name, selectors need a `{ ... }` block at 12..13",
                "Invalid CSS: expected a selector before `{` at 0..1",
                "Invalid CSS: `*zoom` is not a valid property name, selectors need a `{ ... }` block at 0..5",
            ]
        );
    }

    #[test]
    fn rejects_missing_semicolons_between_declarations() {
        assert_eq!(
            [
                error("color: red\n  width: 1px;"),
                error("filter: progid:DXImageTransform.Microsoft.gradient(enabled=false);"),
                error("--x: a: b;"),
                error("grid-template-areas: \"a:b\";"),
                error("width: calc(1px + 2px + 3px + 4px + 5px)\n  color: red;"),
            ],
            [
                "Invalid CSS: missing `;` after `red` at 7..10",
                "ok",
                "ok",
                "ok",
                "Invalid CSS: missing `;` after `)` at 39..40",
            ]
        );
    }

    #[test]
    fn accepts_valid_property_names() {
        assert_eq!(
            error("-webkit-box-shadow: none; --x: 1; ---y: 2; _height: 1px; \\63 olor: red; ñ: 1;"),
            "ok"
        );
    }

    #[test]
    fn rejects_rules_without_a_selector_prelude() {
        assert_eq!(
            [
                error("color: red\n  &:hover { color: blue; }"),
                error("color: red\n  .child { color: blue; }"),
                error("color: red; 50% { opacity: 0; }"),
                error("&:hover: { color: red; }"),
            ],
            [
                "Invalid CSS: missing `;` before a nested rule, `color: red &:hover` is not a valid selector at 0..20",
                "Invalid CSS: missing `;` before a nested rule, `color: red .child` is not a valid selector at 0..19",
                "Invalid CSS: `50%` is not a valid selector at 12..15",
                "Invalid CSS: `&:hover:` is not a valid selector at 0..8",
            ]
        );
    }

    #[test]
    fn accepts_nested_selectors() {
        assert_eq!(
            error(
                "&:hover { a: b; } & > a { a: b; } .a { a: b; } a:not(.b) { a: b; } &:has(> img) { a: b; } :is(a, b) { a: b; } & + & { a: b; } *{ a: b; } [data-x=\"a\"] { a: b; } &:nth-child(2n + 1) { a: b; } &::after { a: b; } input::-webkit-inner-spin-button { a: b; } div span { a: b; } &.a.b:focus-visible { a: b; }"
            ),
            "ok"
        );
    }

    #[test]
    fn accepts_colons_in_custom_property_values() {
        assert_eq!(
            [
                error("--config:\n    theme: dark;"),
                error("--x: a: b;"),
                error("\\2d -config: theme: dark;"),
            ],
            ["ok", "ok", "ok"]
        );
    }
}
