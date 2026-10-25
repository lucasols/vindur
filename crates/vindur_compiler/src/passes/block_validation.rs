use oxc_css_parser::ast::Statement;

use super::css_syntax::{BlockKind, CssError};
use super::css_tokens::skipped_token_end;
use super::css_validation::statement_span;

/// Global styles are a stylesheet, so declarations need a rule. Keyframes contain only keyframe
/// blocks of declarations
pub(super) fn validate_block_kind(
    statements: &[Statement<'_>],
    kind: BlockKind,
    source: &str,
    (start, end): (usize, usize),
) -> Result<(), CssError> {
    if kind != BlockKind::Style {
        reject_stray_semicolons(statements, source, start, end)?;
    }
    for statement in statements {
        let message = match (kind, statement) {
            (BlockKind::Style, _) | (BlockKind::Global, Statement::QualifiedRule(_)) => continue,
            (BlockKind::Global, Statement::AtRule(rule)) => {
                if let Some(block) = &rule.block {
                    let (inner_start, inner_end) =
                        (block.span.start + 1, block.span.end.saturating_sub(1));
                    if is_grouping_at_rule(rule.name.name) {
                        validate_block_kind(
                            &block.statements,
                            kind,
                            source,
                            (inner_start, inner_end),
                        )?;
                    } else if holds_rules(rule.name.name) {
                        reject_stray_semicolons(&block.statements, source, inner_start, inner_end)?;
                    }
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

/// The parser skips a `;` between rules, but browsers read it as the start of the next rule's
/// selector and drop that rule. Global styles are joined, so it can drop a rule of another file.
/// Statements without a block, like `@import url(a.css);`, end with their `;`
fn reject_stray_semicolons(
    statements: &[Statement<'_>],
    source: &str,
    start: usize,
    end: usize,
) -> Result<(), CssError> {
    let mut gap_start = start;
    let mut allows_semicolon = false;
    for statement in statements.iter().map(Some).chain([None]) {
        let gap_end = statement.map_or(end, |statement| statement_span(statement).start);
        let mut index = gap_start;
        while index < gap_end.min(source.len()) {
            if let Some(token_end) = skipped_token_end(source, index) {
                index = token_end;
                continue;
            }
            if source.as_bytes()[index] == b';' {
                if !allows_semicolon {
                    return Err(CssError::syntax(
                        "unexpected `;` after a rule, remove it".to_owned(),
                        index,
                        index + 1,
                    ));
                }
                allows_semicolon = false;
            }
            index += source[index..].chars().next().map_or(1, char::len_utf8);
        }
        if let Some(statement) = statement {
            gap_start = statement_span(statement).end;
            allows_semicolon = !ends_with_block(statement) && !source[..gap_start].ends_with(';');
        }
    }
    Ok(())
}

pub(super) fn validate_global_top_level(
    statements: &[Statement<'_>],
    source: &str,
) -> Result<(), CssError> {
    reject_late_stylesheet_start_rules(statements)?;
    reject_unterminated_global_end(statements, source)
}

/// Browsers drop `@charset`, `@import` and `@namespace` after any other rule, only `@layer`
/// statements can come before them
fn reject_late_stylesheet_start_rules(statements: &[Statement<'_>]) -> Result<(), CssError> {
    let mut seen_rule = false;
    for statement in statements {
        let name = match statement {
            Statement::AtRule(rule) => rule.name.name.to_ascii_lowercase(),
            _ => String::new(),
        };
        let starts_stylesheet = matches!(name.as_str(), "charset" | "import" | "namespace");
        if starts_stylesheet && seen_rule {
            let span = statement_span(statement);
            return Err(CssError::syntax(
                format!("`@{name}` must come before every rule in `createGlobalStyle`"),
                span.start,
                span.end,
            ));
        }
        let is_layer_statement =
            matches!(statement, Statement::AtRule(rule) if name == "layer" && rule.block.is_none());
        seen_rule |= !starts_stylesheet && !is_layer_statement;
    }
    Ok(())
}

/// Global styles are joined with other files, so a last `@import url(a.css)` without its `;` would
/// take the next file's rule as its block
fn reject_unterminated_global_end(
    statements: &[Statement<'_>],
    source: &str,
) -> Result<(), CssError> {
    let Some(Statement::AtRule(rule)) = statements.last() else {
        return Ok(());
    };
    if rule.block.is_some() || source[..rule.span.end].ends_with(';') {
        return Ok(());
    }
    let mut index = rule.span.end;
    while index < source.len() {
        if let Some(token_end) = skipped_token_end(source, index) {
            index = token_end;
            continue;
        }
        let Some(character) = source[index..].chars().next() else {
            break;
        };
        if character == ';' {
            return Ok(());
        }
        if !character.is_whitespace() {
            break;
        }
        index += character.len_utf8();
    }
    Err(CssError::syntax(
        format!(
            "missing `;` after `@{}`, global styles are joined with other styles",
            rule.name.raw
        ),
        rule.span.start,
        rule.span.end,
    ))
}

/// At-rules whose block holds rules, so a `;` between them drops the next one
fn holds_rules(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    let name = name
        .strip_prefix("-webkit-")
        .or_else(|| name.strip_prefix("-moz-"))
        .unwrap_or(&name);
    matches!(name, "keyframes" | "font-feature-values")
}

fn ends_with_block(statement: &Statement<'_>) -> bool {
    match statement {
        Statement::AtRule(rule) => rule.block.is_some(),
        Statement::QualifiedRule(_)
        | Statement::UnknownQualifiedRule(_)
        | Statement::KeyframeBlock(_) => true,
        _ => false,
    }
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

#[cfg(test)]
mod tests {
    use super::super::css_syntax::{BlockKind, validate_style_block};

    fn kind_error(css: &str, kind: BlockKind) -> String {
        match validate_style_block(css, kind) {
            Ok(()) => "ok".to_owned(),
            Err(error) => format!("{} at {}..{}", error.message, error.start, error.end),
        }
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
                kind_error("@\\6d edia print { color: red; }", BlockKind::Global),
            ],
            [
                "Invalid CSS: declarations in createGlobalStyle need a rule, e.g. `body { ... }` at 0..10",
                "ok",
                "Invalid CSS: keyframes templates can only contain keyframe blocks, e.g. `from { ... } to { ... }` at 0..10",
                "Invalid CSS: keyframes can only contain declarations at 7..30",
                "ok",
                "Invalid CSS: declarations in createGlobalStyle need a rule, e.g. `body { ... }` at 18..28",
            ]
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
    fn rejects_stray_semicolons_in_global_styles() {
        assert_eq!(
            [
                kind_error("body { margin: 0; };", BlockKind::Global),
                kind_error(
                    "@media print { a { b: c; }; b { c: d; } }",
                    BlockKind::Global
                ),
                kind_error(
                    "@import url(a.css); @layer a, b; /* ; */ body { margin: 0; }",
                    BlockKind::Global
                ),
            ],
            [
                "Invalid CSS: unexpected `;` after a rule, remove it at 19..20",
                "Invalid CSS: unexpected `;` after a rule, remove it at 26..27",
                "ok",
            ]
        );
    }

    #[test]
    fn rejects_stray_semicolons_in_keyframe_blocks() {
        assert_eq!(
            [
                kind_error(
                    "from { opacity: 0; }; to { opacity: 1; }",
                    BlockKind::Keyframes
                ),
                kind_error("@keyframes a { from { opacity: 0; }; }", BlockKind::Global),
                kind_error(
                    "@font-feature-values Font { @swash { fancy: 1; }; }",
                    BlockKind::Global
                ),
            ],
            [
                "Invalid CSS: unexpected `;` after a rule, remove it at 20..21",
                "Invalid CSS: unexpected `;` after a rule, remove it at 35..36",
                "Invalid CSS: unexpected `;` after a rule, remove it at 48..49",
            ]
        );
    }

    #[test]
    fn validates_global_top_level_statements() {
        assert_eq!(
            [
                kind_error("@import url(a.css)", BlockKind::Global),
                kind_error("@layer a, b", BlockKind::Global),
                kind_error("body { margin: 0; } @import url(a.css);", BlockKind::Global),
                kind_error(
                    "@charset \"utf-8\"; @layer a; @import url(a.css); @namespace svg url(x); body { margin: 0; }",
                    BlockKind::Global
                ),
            ],
            [
                "Invalid CSS: missing `;` after `@import`, global styles are joined with other styles at 0..18",
                "Invalid CSS: missing `;` after `@layer`, global styles are joined with other styles at 0..11",
                "Invalid CSS: `@import` must come before every rule in `createGlobalStyle` at 20..38",
                "ok",
            ]
        );
    }
}
