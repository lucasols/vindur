use super::css_syntax::CssError;
use super::css_tokens::{
    escape_end, ident_end, is_css_whitespace, is_ident_char, is_url_function, skipped_token_end,
};

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
        if let Some(arguments_start) = unquoted_url_arguments_start(css, index) {
            index = unquoted_url_end(css, arguments_start).ok_or_else(|| {
                CssError::syntax(
                    "unclosed `url(`, add `)`".to_owned(),
                    index,
                    arguments_start,
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

/// Where the arguments of an unquoted `url(` start, the function name can be escaped like
/// `u\72l(`
fn unquoted_url_arguments_start(css: &str, index: usize) -> Option<usize> {
    let arguments_start = if is_url_function(css, index) {
        index + "url(".len()
    } else {
        if !css[index..].chars().next().is_some_and(is_ident_char)
            || css[..index].chars().next_back().is_some_and(is_ident_char)
        {
            return None;
        }
        let name_end = ident_end(css, index);
        let name = &css[index..name_end];
        if !name.contains('\\')
            || !decode_ident(name).eq_ignore_ascii_case("url")
            || css.as_bytes().get(name_end) != Some(&b'(')
        {
            return None;
        }
        name_end + 1
    };
    (!css[arguments_start..]
        .trim_start_matches(is_css_whitespace)
        .starts_with(['"', '\'']))
    .then_some(arguments_start)
}

fn decode_ident(raw: &str) -> String {
    let mut decoded = String::with_capacity(raw.len());
    let mut index = 0;
    while let Some(character) = raw[index..].chars().next() {
        if character != '\\' {
            decoded.push(character);
            index += character.len_utf8();
            continue;
        }
        let end = escape_end(raw, index);
        let escaped = raw[index + 1..end].trim_end_matches(is_css_whitespace);
        let hex = u32::from_str_radix(escaped, 16)
            .ok()
            .and_then(char::from_u32);
        match hex {
            Some(character) if escaped.bytes().all(|byte| byte.is_ascii_hexdigit()) => {
                decoded.push(character);
            }
            _ => decoded.push_str(escaped),
        }
        index = end;
    }
    decoded
}

/// The end of an unquoted `url(...)`, `None` when it is not closed before a quote, a `(`, or
/// whitespace that is not followed by `)`
fn unquoted_url_end(css: &str, arguments_start: usize) -> Option<usize> {
    let mut seen_value = false;
    let mut index = arguments_start;
    while let Some(character) = css[index..].chars().next() {
        match character {
            ')' => return Some(index + 1),
            '\\' => {
                index = escape_end(css, index);
                seen_value = true;
                continue;
            }
            '"' | '\'' | '(' => return None,
            character if is_css_whitespace(character) => {
                if seen_value {
                    let rest = &css[index..];
                    let trimmed = rest.trim_start_matches(is_css_whitespace);
                    return trimmed
                        .starts_with(')')
                        .then(|| index + rest.len() - trimmed.len() + 1);
                }
            }
            _ => seen_value = true,
        }
        index += character.len_utf8();
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
            "background: url(foo\\20 bar.png); mask: url(a\u{a0}b.png);",
            "background: u\\72l(a[b.png);",
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
