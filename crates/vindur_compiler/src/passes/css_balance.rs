use super::css_syntax::CssError;
use super::unsupported_css_syntax::{is_url_function, skipped_token_end};

const URL_START: &str = "url(";

/// Fails on an unclosed comment, an unclosed `(`, `[` or `url(`, or an unexpected `)` or `]`.
/// oxc-css-parser 0.0.17 does not report these inside nested blocks, where they swallow the rules
/// after them, remove this check once the parser reports them
pub(super) fn check_balance(css: &str) -> Result<(), CssError> {
    let mut open: Vec<(u8, usize)> = Vec::new();
    let mut index = 0;
    while index < css.len() {
        if css[index..].starts_with("/*") && !css[index + 2..].contains("*/") {
            return Err(CssError::syntax(
                "unclosed comment, add `*/`".to_owned(),
                index,
                index + 2,
            ));
        }
        if is_unquoted_url(css, index) {
            index = unquoted_url_end(css, index).ok_or_else(|| {
                CssError::syntax(
                    "unclosed `url(`, add `)`".to_owned(),
                    index,
                    index + URL_START.len(),
                )
            })?;
            continue;
        }
        if let Some(end) = skipped_token_end(css, index) {
            index = end;
            continue;
        }
        match css.as_bytes()[index] {
            byte @ (b'(' | b'[' | b'{') => open.push((byte, index)),
            byte @ (b')' | b']' | b'}') => close(&mut open, byte, index)?,
            _ => {}
        }
        index += css[index..].chars().next().map_or(1, char::len_utf8);
    }
    // Unclosed `{` are reported by the parser
    match open.iter().rev().find(|(byte, _)| *byte != b'{') {
        Some(&(byte, start)) => Err(unclosed(byte, start)),
        None => Ok(()),
    }
}

fn close(open: &mut Vec<(u8, usize)>, closer: u8, index: usize) -> Result<(), CssError> {
    let opener = match closer {
        b')' => b'(',
        b']' => b'[',
        _ => b'{',
    };
    match open.last().copied() {
        Some((byte, _)) if byte == opener => {
            open.pop();
            Ok(())
        }
        Some((byte @ (b'(' | b'['), start)) => Err(unclosed(byte, start)),
        // An unexpected `}` is reported by the parser
        _ if closer == b'}' => Ok(()),
        _ => Err(CssError::syntax(
            format!("unexpected `{}`", char::from(closer)),
            index,
            index + 1,
        )),
    }
}

fn unclosed(opener: u8, start: usize) -> CssError {
    let closer = if opener == b'(' { ')' } else { ']' };
    CssError::syntax(
        format!("unclosed `{}`, add `{closer}`", char::from(opener)),
        start,
        start + 1,
    )
}

fn is_unquoted_url(css: &str, index: usize) -> bool {
    is_url_function(css, index)
        && !css[index + URL_START.len()..]
            .trim_start()
            .starts_with(['"', '\''])
}

/// The end of an unquoted `url(...)`, `None` when it is not closed before a quote, a `(`, or
/// whitespace that is not followed by `)`
fn unquoted_url_end(css: &str, start: usize) -> Option<usize> {
    let arguments_start = start + URL_START.len();
    let arguments = &css[arguments_start..];
    let mut seen_value = false;
    let mut characters = arguments.char_indices();
    while let Some((offset, character)) = characters.next() {
        match character {
            ')' => return Some(arguments_start + offset + 1),
            '\\' => {
                characters.next();
                seen_value = true;
            }
            '"' | '\'' | '(' => return None,
            character if character.is_whitespace() => {
                if !seen_value {
                    continue;
                }
                let rest = &arguments[offset..];
                let trimmed = rest.trim_start();
                return trimmed
                    .starts_with(')')
                    .then(|| arguments_start + offset + rest.len() - trimmed.len() + 1);
            }
            _ => seen_value = true,
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::check_balance;

    fn check(css: &str) -> String {
        match check_balance(css) {
            Ok(()) => "ok".to_owned(),
            Err(error) => format!("{} at {}..{}", error.message, error.start, error.end),
        }
    }

    #[test]
    fn accepts_balanced_css() {
        for css in [
            "width: calc(100% - (2px * 2)); &:hover { color: red; }",
            "content: \"( [ /* url(\"; grid-template-columns: [a] 1fr;",
            "/* ( [ { */ color: red;",
            "background: url(a.png); mask: url( b.svg ); cursor: url(\"c.cur\"), auto;",
            "background: url(a\\).png); content: 'é(';",
            "--x: { a: [b] }; } stray: brace;",
        ] {
            assert_eq!(check(css), "ok", "{css}");
        }
    }

    #[test]
    fn rejects_unclosed_comments() {
        assert_eq!(
            check("color: red; /* note"),
            "Invalid CSS: unclosed comment, add `*/` at 12..14"
        );
    }

    #[test]
    fn rejects_unclosed_brackets() {
        assert_eq!(
            [
                check("&:hover { width: calc(100% - 2px; } color: red;"),
                check("&:hover { grid-template-columns: [a 1fr; }"),
                check("&:hover { background: url(a.png; }"),
                check("&:hover { background: url(a.png }"),
                check("&:hover { width: calc(1px + (2px); }"),
            ],
            [
                "Invalid CSS: unclosed `(`, add `)` at 21..22",
                "Invalid CSS: unclosed `[`, add `]` at 33..34",
                "Invalid CSS: unclosed `url(`, add `)` at 22..26",
                "Invalid CSS: unclosed `url(`, add `)` at 22..26",
                "Invalid CSS: unclosed `(`, add `)` at 21..22",
            ]
        );
    }

    #[test]
    fn rejects_unexpected_closers() {
        assert_eq!(
            [
                check("&:hover { width: 1px); }"),
                check("width: calc(1px]);"),
            ],
            [
                "Invalid CSS: unexpected `)` at 20..21",
                "Invalid CSS: unclosed `(`, add `)` at 11..12",
            ]
        );
    }
}
