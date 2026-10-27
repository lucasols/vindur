use oxc_css_parser::ast::{AtRule, Statement};

use super::css_syntax::{BlockKind, CssError};
use super::css_tokens::{decode_ident, ident_end, skipped_token_end, unprefixed_at_rule_name};
use super::css_validation::statement_span;

/// Global styles are a stylesheet, so declarations need a rule. Keyframes contain only keyframe
/// blocks of declarations
pub(super) fn validate_block_kind(
    statements: &[Statement<'_>],
    kind: BlockKind,
    source: &str,
    (start, end): (usize, usize),
) -> Result<(), CssError> {
    for statement in statements {
        let message = match (kind, statement) {
            (BlockKind::Style, _) | (BlockKind::Global, Statement::QualifiedRule(_)) => continue,
            (BlockKind::Global, Statement::AtRule(rule)) => {
                validate_global_at_rule(rule, source)?;
                continue;
            }
            (BlockKind::Global, _) => {
                "declarations in createGlobalStyle need a rule, e.g. `body { ... }`"
            }
            (BlockKind::Keyframes, Statement::KeyframeBlock(block)) => {
                for nested in &block.block.statements {
                    let message = match nested {
                        // Browsers ignore `!important` declarations in keyframes
                        Statement::Declaration(declaration) if declaration.important.is_some() => {
                            "`!important` is ignored in keyframes, remove it"
                        }
                        Statement::Declaration(_) => continue,
                        _ => "keyframes can only contain declarations",
                    };
                    let span = statement_span(nested);
                    return Err(CssError::syntax(message.to_owned(), span.start, span.end));
                }
                continue;
            }
            (BlockKind::Keyframes, _) => {
                "keyframes can only contain keyframe blocks, e.g. `from { ... } to { ... }`"
            }
        };
        let span = statement_span(statement);
        return Err(CssError::syntax(message.to_owned(), span.start, span.end));
    }
    // After the statements, a misplaced declaration is reported as such, not as its `;`
    if kind != BlockKind::Style {
        reject_stray_semicolons(statements, source, start, end)?;
    }
    Ok(())
}

/// The block of an at-rule in global styles, grouping rules hold a stylesheet
fn validate_global_at_rule(rule: &AtRule<'_>, source: &str) -> Result<(), CssError> {
    let Some(block) = &rule.block else {
        return Ok(());
    };
    let inner = (block.span.start + 1, block.span.end.saturating_sub(1));
    let name = unprefixed_at_rule_name(rule.name.name).unwrap_or_default();
    if is_grouping_at_rule(&name) {
        validate_block_kind(&block.statements, BlockKind::Global, source, inner)?;
    } else if name == "scope" {
        // Declarations in `@scope` style the scope root, its at-rules are checked as usual
        for statement in &block.statements {
            if let Statement::AtRule(nested) = statement {
                validate_global_at_rule(nested, source)?;
            }
        }
    } else if name == "keyframes" {
        validate_block_kind(&block.statements, BlockKind::Keyframes, source, inner)?;
    } else if name == "font-feature-values" {
        // Its block holds rules, so a `;` between them drops the next one
        reject_stray_semicolons(&block.statements, source, inner.0, inner.1)?;
    } else if DECLARATION_AT_RULES.contains(&name.as_str())
        && let Some(nested) = block
            .statements
            .iter()
            .find(|statement| !matches!(statement, Statement::Declaration(_)))
    {
        let span = statement_span(nested);
        return Err(CssError::syntax(
            format!("`@{}` can only contain declarations", rule.name.raw),
            span.start,
            span.end,
        ));
    }
    Ok(())
}

/// At-rules whose blocks only hold declarations, browsers drop rules nested in them
const DECLARATION_AT_RULES: [&str; 6] = [
    "font-face",
    "property",
    "counter-style",
    "font-palette-values",
    "position-try",
    "view-transition",
];

/// The parser skips a `;` between rules, but browsers read it as the start of the next rule's
/// selector and drop that rule. Global styles are joined, so it can drop a rule of another file.
/// Statements without a block, like `@import url(a.css);`, end with their `;`. A `;` at the start
/// of the template is removed from the output
fn reject_stray_semicolons(
    statements: &[Statement<'_>],
    source: &str,
    start: usize,
    end: usize,
) -> Result<(), CssError> {
    let mut gap_start = start;
    let mut allows_semicolon = false;
    let mut after_block = false;
    for statement in statements.iter().map(Some).chain([None]) {
        let gap_end = statement.map_or(end, |statement| statement_span(statement).start);
        let mut index = gap_start;
        while index < gap_end.min(source.len()) {
            if let Some(token_end) = skipped_token_end(source, index) {
                index = token_end;
                continue;
            }
            if source.as_bytes()[index] == b';' {
                let is_template_start = start == 0 && source[..index].trim().is_empty();
                if !allows_semicolon && !is_template_start {
                    let message = if after_block {
                        "unexpected `;` after a rule, remove it"
                    } else {
                        "unexpected `;`, remove it"
                    };
                    return Err(CssError::syntax(message.to_owned(), index, index + 1));
                }
                allows_semicolon = false;
            }
            index += source[index..].chars().next().map_or(1, char::len_utf8);
        }
        if let Some(statement) = statement {
            gap_start = statement_span(statement).end;
            after_block = ends_with_block(statement);
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

/// Where a statement can be at the start of a stylesheet, browsers drop `@charset`, `@import` and
/// `@namespace` after a statement that must come after them
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum StartOrder {
    Charset,
    /// A `@layer a, b;` statement before the imports
    Layer,
    Import,
    Namespace,
    Rule,
}

/// The order is `@charset`, `@layer` statements, `@import` and `@namespace`, then every other
/// rule. A `@layer` statement after an `@import` ends the imports
fn reject_late_stylesheet_start_rules(statements: &[Statement<'_>]) -> Result<(), CssError> {
    // The latest order and the at-rule that set it, `None` for any other rule
    let mut latest: Option<(StartOrder, Option<&'static str>)> = None;
    for statement in statements {
        let name = match statement {
            Statement::AtRule(rule) => unprefixed_at_rule_name(rule.name.name).unwrap_or_default(),
            _ => String::new(),
        };
        let latest_order = latest.map(|(order, _)| order);
        let (order, label) = match name.as_str() {
            "charset" => (StartOrder::Charset, Some("@charset")),
            "import" => (StartOrder::Import, Some("@import")),
            "namespace" => (StartOrder::Namespace, Some("@namespace")),
            "layer" if matches!(statement, Statement::AtRule(rule) if rule.block.is_none()) => {
                let order = if latest_order.is_none_or(|order| order <= StartOrder::Layer) {
                    StartOrder::Layer
                } else {
                    StartOrder::Rule
                };
                (order, Some("@layer"))
            }
            _ => (StartOrder::Rule, None),
        };
        if let Some((latest_order, latest_label)) = latest
            && order < latest_order
        {
            let span = statement_span(statement);
            let message = match latest_label {
                Some(label) => {
                    format!("`@{name}` must come before `{label}` in `createGlobalStyle`")
                }
                None => format!("`@{name}` must come before every rule in `createGlobalStyle`"),
            };
            return Err(CssError::syntax(message, span.start, span.end));
        }
        if latest_order.is_none_or(|latest_order| order > latest_order) {
            latest = Some((order, label));
        }
    }
    Ok(())
}

/// Whether validated global styles start with `@charset`, `@import` or `@namespace`, maybe after
/// `@layer` statements. Browsers drop them after another rule, also one of another template
pub(super) fn starts_with_stylesheet_start_rule(css: &str) -> bool {
    let mut index = 0;
    while let Some(character) = css[index..].chars().next() {
        if character.is_whitespace() {
            index += character.len_utf8();
            continue;
        }
        if css[index..].starts_with("/*")
            && let Some(end) = skipped_token_end(css, index)
        {
            index = end;
            continue;
        }
        if character != '@' {
            return false;
        }
        let name_end = ident_end(css, index + 1);
        match unprefixed_at_rule_name(&decode_ident(&css[index + 1..name_end])).as_deref() {
            Some("charset" | "import" | "namespace") => return true,
            Some("layer") => match statement_end(css, name_end) {
                Some(end) => index = end,
                None => return false,
            },
            _ => return false,
        }
    }
    false
}

/// The end of a block-less statement after `index`, `None` when the statement has a block
fn statement_end(css: &str, mut index: usize) -> Option<usize> {
    while let Some(character) = css[index..].chars().next() {
        if let Some(end) = skipped_token_end(css, index) {
            index = end;
            continue;
        }
        match character {
            ';' => return Some(index + 1),
            '{' => return None,
            _ => index += character.len_utf8(),
        }
    }
    None
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
    matches!(
        name,
        "media" | "supports" | "container" | "layer" | "document" | "starting-style"
    )
}

#[cfg(test)]
mod tests {
    use super::super::css_syntax::{BlockKind, validate_style_block};
    use super::starts_with_stylesheet_start_rule;

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
                "Invalid CSS: keyframes can only contain keyframe blocks, e.g. `from { ... } to { ... }` at 0..10",
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
    fn validates_keyframes_in_global_styles() {
        assert_eq!(
            [
                kind_error("@keyframes a { opacity: 0; }", BlockKind::Global),
                kind_error(
                    "@-o-keyframes a { from { @media print { opacity: 0; } } }",
                    BlockKind::Global
                ),
                kind_error(
                    "@-webkit-keyframes a { from { opacity: 0; } to { opacity: 1; } }",
                    BlockKind::Global
                ),
            ],
            [
                "Invalid CSS: keyframes can only contain keyframe blocks, e.g. `from { ... } to { ... }` at 15..25",
                "Invalid CSS: keyframes can only contain declarations at 25..53",
                "ok",
            ]
        );
    }

    #[test]
    fn allows_a_semicolon_at_the_start_of_global_styles() {
        assert_eq!(
            [
                kind_error("; body { margin: 0; }", BlockKind::Global),
                kind_error(";; body { margin: 0; }", BlockKind::Global),
                kind_error("/* a */ ; body { margin: 0; }", BlockKind::Global),
                kind_error("@media print { ; a { b: c; } }", BlockKind::Global),
            ],
            [
                "ok",
                "Invalid CSS: unexpected `;`, remove it at 1..2",
                "Invalid CSS: unexpected `;`, remove it at 8..9",
                "Invalid CSS: unexpected `;`, remove it at 15..16",
            ]
        );
    }

    #[test]
    fn finds_stylesheet_start_rules() {
        assert_eq!(
            [
                "/* a */ @import url(a.css);",
                "@layer a, b; @namespace svg url(x);",
                "@\\69mport url(a.css);",
                "@layer a { body { margin: 0; } }",
                "body { margin: 0; }",
            ]
            .map(starts_with_stylesheet_start_rule),
            [true, true, true, false, false]
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
                    "@charset \"utf-8\"; @layer a; @import url(a.css); @namespace svg url(x); @layer b; body { margin: 0; }",
                    BlockKind::Global
                ),
                kind_error(
                    "@import url(a.css); @layer a; @import url(b.css);",
                    BlockKind::Global
                ),
                kind_error(
                    "@namespace svg url(x); @import url(a.css);",
                    BlockKind::Global
                ),
            ],
            [
                "Invalid CSS: missing `;` after `@import`, global styles are joined with other styles at 0..18",
                "Invalid CSS: missing `;` after `@layer`, global styles are joined with other styles at 0..11",
                "Invalid CSS: `@import` must come before every rule in `createGlobalStyle` at 20..38",
                "ok",
                "Invalid CSS: `@import` must come before `@layer` in `createGlobalStyle` at 30..48",
                "Invalid CSS: `@import` must come before `@namespace` in `createGlobalStyle` at 23..41",
            ]
        );
    }
}
