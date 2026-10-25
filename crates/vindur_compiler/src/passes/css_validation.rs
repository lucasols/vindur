use oxc_css_parser::{
    ast::{ComponentValue, Declaration, InterpolableIdent, Statement, TokenSeq},
    token::TokenData,
};

use super::css_syntax::{BlockKind, CssError};
use super::unsupported_css_syntax::is_ident_char;

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
    let text = source[prelude.span.start..prelude.span.end]
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let is_declaration_shaped = text.contains(':')
        && !text
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_digit() || character == '.');
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
    // can contain `name:`, so for them only a `name:` on a new line is a missing `;`
    let is_custom_property = name.raw.starts_with("--");
    let next_property = declaration.value.windows(2).find_map(|pair| match pair {
        [
            ComponentValue::TokenWithSpan(ident),
            ComponentValue::TokenWithSpan(colon),
        ] if matches!(ident.token, TokenData::Ident(_))
            && matches!(colon.token, TokenData::Colon(_))
            && (!is_custom_property || starts_line(source, ident.span.start)) =>
        {
            Some(ident)
        }
        _ => None,
    });
    match next_property {
        Some(ident) => Err(CssError::syntax(
            format!("missing `;` before `{}`", ident.raw(source)),
            ident.span.start,
            ident.span.end,
        )),
        None => Ok(()),
    }
}

fn starts_line(source: &str, offset: usize) -> bool {
    source[..offset]
        .chars()
        .rev()
        .take_while(char::is_ascii_whitespace)
        .any(|character| character == '\n')
}

/// Global styles are a stylesheet, so declarations need a rule. Keyframes contain only keyframe
/// blocks of declarations
pub(super) fn validate_block_kind(
    statements: &[Statement<'_>],
    kind: BlockKind,
) -> Result<(), CssError> {
    for statement in statements {
        let message = match (kind, statement) {
            (BlockKind::Style, _) | (BlockKind::Global, Statement::QualifiedRule(_)) => continue,
            (BlockKind::Global, Statement::AtRule(rule)) => {
                if let Some(block) = &rule.block
                    && is_grouping_at_rule(rule.name.raw)
                {
                    validate_block_kind(&block.statements, kind)?;
                }
                continue;
            }
            (BlockKind::Global, _) => {
                "declarations in createGlobalStyle need a rule, e.g. `body { ... }`"
            }
            (BlockKind::Keyframes, Statement::KeyframeBlock(block)) => {
                match block
                    .block
                    .statements
                    .iter()
                    .find(|statement| !matches!(statement, Statement::Declaration(_)))
                {
                    Some(nested) => {
                        let span = statement_span(nested);
                        return Err(CssError::syntax(
                            "keyframes can only contain declarations".to_owned(),
                            span.start,
                            span.end,
                        ));
                    }
                    None => continue,
                }
            }
            (BlockKind::Keyframes, _) => {
                "keyframes templates can only contain keyframe blocks, e.g. `from { ... } to { ... }`"
            }
        };
        let span = statement_span(statement);
        return Err(CssError::syntax(message.to_owned(), span.start, span.end));
    }
    Ok(())
}

/// Conditional and layer at-rules hold rules at the top level of a stylesheet. `@scope` is not
/// included because its declarations apply to the scoping root
fn is_grouping_at_rule(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    let name = name
        .strip_prefix("-webkit-")
        .or_else(|| name.strip_prefix("-moz-"))
        .unwrap_or(&name);
    matches!(
        name,
        "media" | "supports" | "container" | "layer" | "document" | "starting-style"
    )
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

    fn kind_error(css: &str, kind: BlockKind) -> String {
        match validate_style_block(css, kind) {
            Ok(()) => "ok".to_owned(),
            Err(error) => format!("{} at {}..{}", error.message, error.start, error.end),
        }
    }

    #[test]
    fn rejects_missing_semicolons_between_declarations() {
        assert_eq!(
            [
                error("color: red\n  width: 1px;"),
                error("filter: progid:DXImageTransform.Microsoft.gradient(enabled=false);"),
                error("--x: a: b;"),
                error("grid-template-areas: \"a:b\";"),
            ],
            [
                "Invalid CSS: missing `;` before `width` at 13..18",
                "ok",
                "ok",
                "ok",
            ]
        );
    }

    #[test]
    fn validates_global_and_keyframes_structure() {
        assert_eq!(
            [
                kind_error("color: red;", BlockKind::Global),
                kind_error(
                    "& { color: red; } @media (width > 1px) { body { color: red; } }",
                    BlockKind::Global
                ),
                kind_error("opacity: 0;", BlockKind::Keyframes),
                kind_error("from { &:hover { color: red; } }", BlockKind::Keyframes),
                kind_error(
                    "entry 0% { opacity: 0; } to { opacity: 1; }",
                    BlockKind::Keyframes
                ),
            ],
            [
                "Invalid CSS: declarations in createGlobalStyle need a rule, e.g. `body { ... }` at 0..10",
                "ok",
                "Invalid CSS: keyframes templates can only contain keyframe blocks, e.g. `from { ... } to { ... }` at 0..10",
                "Invalid CSS: keyframes can only contain declarations at 7..30",
                "ok",
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
            ],
            [
                "Invalid CSS: missing `;` before a nested rule, `color: red &:hover` is not a valid selector at 0..20",
                "Invalid CSS: missing `;` before a nested rule, `color: red .child` is not a valid selector at 0..19",
                "Invalid CSS: `50%` is not a valid selector at 12..15",
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
    fn rejects_declarations_in_global_grouping_rules() {
        assert_eq!(
            [
                kind_error("@media print { color: red; }", BlockKind::Global),
                kind_error(
                    "@supports (display: grid) { @layer base { color: red; } }",
                    BlockKind::Global
                ),
                kind_error(
                    "@media print { body { color: red; } } @scope (.a) { color: red; } @font-face { font-family: x; } @page { margin: 0; }",
                    BlockKind::Global
                ),
            ],
            [
                "Invalid CSS: declarations in createGlobalStyle need a rule, e.g. `body { ... }` at 15..25",
                "Invalid CSS: declarations in createGlobalStyle need a rule, e.g. `body { ... }` at 42..52",
                "ok",
            ]
        );
    }

    #[test]
    fn rejects_missing_semicolons_after_custom_properties() {
        assert_eq!(
            [
                error("---size: 10px\n  width: var(---size);"),
                error("--x: 1px\n  width: 2px;"),
                error("--x: a: b;"),
            ],
            [
                "Invalid CSS: missing `;` before `width` at 16..21",
                "Invalid CSS: missing `;` before `width` at 11..16",
                "ok",
            ]
        );
    }
}
