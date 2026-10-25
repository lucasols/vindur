// Comments, strings, escapes and unquoted urls can't contain unsupported syntax
pub(super) fn skipped_token_end(css: &str, index: usize) -> Option<usize> {
    let rest = &css[index..];
    if let Some(comment) = rest.strip_prefix("/*") {
        return Some(
            comment
                .find("*/")
                .map_or(css.len(), |end| index + 2 + end + 2),
        );
    }
    match rest.as_bytes().first() {
        Some(b'"' | b'\'') => Some(string_end(css, index)),
        Some(b'\\') => Some(escape_end(css, index)),
        _ if is_url_function(css, index) => Some(url_end(css, index)),
        _ => None,
    }
}

/// The end of the escape starting with the `\` at `start`, a hex escape like `\6f ` includes the
/// whitespace that terminates it
pub(super) fn escape_end(css: &str, start: usize) -> usize {
    let rest = &css[start + 1..];
    let hex_len = rest
        .bytes()
        .take(6)
        .take_while(u8::is_ascii_hexdigit)
        .count();
    if hex_len == 0 {
        return start + 1 + rest.chars().next().map_or(0, char::len_utf8);
    }
    let after = &rest[hex_len..];
    let whitespace_len = if after.starts_with("\r\n") {
        2
    } else {
        usize::from(after.starts_with(is_css_whitespace))
    };
    start + 1 + hex_len + whitespace_len
}

pub(super) fn is_css_whitespace(character: char) -> bool {
    matches!(character, ' ' | '\t' | '\n' | '\r' | '\x0C')
}

/// The end of the identifier starting at `start`, escapes are part of it
pub(super) fn ident_end(css: &str, start: usize) -> usize {
    let mut index = start;
    while let Some(character) = css[index..].chars().next() {
        if character == '\\' {
            index = escape_end(css, index);
        } else if is_ident_char(character) {
            index += character.len_utf8();
        } else {
            break;
        }
    }
    index
}

fn string_end(css: &str, start: usize) -> usize {
    let bytes = css.as_bytes();
    let quote = bytes[start];
    let mut index = start + 1;
    while index < bytes.len() {
        match bytes[index] {
            b'\\' => index += 2,
            b'\n' => return index,
            byte if byte == quote => return index + 1,
            _ => index += 1,
        }
    }
    bytes.len()
}

pub(super) fn is_url_function(css: &str, index: usize) -> bool {
    css.get(index..index + 4)
        .is_some_and(|name| name.eq_ignore_ascii_case("url("))
        && !css[..index].chars().next_back().is_some_and(is_ident_char)
}

// Quoted urls are skipped as strings, so only the `url` name is skipped and
// its parentheses are tracked as usual, unquoted ones are skipped entirely
fn url_end(css: &str, start: usize) -> usize {
    let arguments_start = start + 4;
    let arguments = &css[arguments_start..];
    if arguments.trim_start().starts_with(['"', '\'']) {
        return start + 3;
    }
    let mut index = arguments_start;
    while index < css.len() {
        match css.as_bytes()[index] {
            b'\\' => index = escape_end(css, index),
            b')' => return index + 1,
            _ => index += 1,
        }
    }
    css.len()
}

pub(super) fn is_ident_char(character: char) -> bool {
    character.is_ascii_alphanumeric()
        || character == '-'
        || character == '_'
        || character == '\\'
        || !character.is_ascii()
}
