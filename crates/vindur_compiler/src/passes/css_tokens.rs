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
    // Before escapes, an escaped name like `\75 rl(` is still a url
    if let Some(paren) = url_function_paren(css, index) {
        return Some(url_end(css, paren));
    }
    match rest.as_bytes().first() {
        Some(b'"' | b'\'') => Some(string_end(css, index)),
        Some(b'\\') => Some(escape_end(css, index)),
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
    scan_string(css, start).0
}

/// The end of the string starting at `start` and whether its closing quote was found
pub(super) fn scan_string(css: &str, start: usize) -> (usize, bool) {
    let bytes = css.as_bytes();
    let quote = bytes[start];
    let mut index = start + 1;
    while index < bytes.len() {
        match bytes[index] {
            // An escaped newline continues the string, `\r\n` is a single newline
            b'\\' if css[index + 1..].starts_with("\r\n") => index += 3,
            b'\\' => index += 2,
            b'\n' => return (index, false),
            byte if byte == quote => return (index + 1, true),
            _ => index += 1,
        }
    }
    (bytes.len(), false)
}

/// Whether the end of the CSS is inside a string or a comment that is still open
pub(super) fn ends_in_string_or_comment(css: &str) -> bool {
    let mut index = 0;
    while index < css.len() {
        let rest = &css[index..];
        if rest.starts_with("/*") && !rest[2..].contains("*/") {
            return true;
        }
        if rest.starts_with(['"', '\'']) {
            let (end, closed) = scan_string(css, index);
            if end >= css.len() && !closed {
                return true;
            }
            index = end;
            continue;
        }
        if let Some(end) = skipped_token_end(css, index) {
            index = end;
            continue;
        }
        index += rest.chars().next().map_or(1, char::len_utf8);
    }
    false
}

/// The index of the `(` of a `url(` function starting at `index`, its name can be escaped like
/// `u\72l(`
fn url_function_paren(css: &str, index: usize) -> Option<usize> {
    if !css[index..].starts_with(['u', 'U', '\\'])
        || css[..index].chars().next_back().is_some_and(is_ident_char)
    {
        return None;
    }
    let name_end = ident_end(css, index);
    (css.as_bytes().get(name_end) == Some(&b'(')
        && decode_ident(&css[index..name_end]).eq_ignore_ascii_case("url"))
    .then_some(name_end)
}

// Quoted urls are skipped as strings, so only the `url` name is skipped and
// its parentheses are tracked as usual, unquoted ones are skipped entirely
fn url_end(css: &str, paren: usize) -> usize {
    let arguments_start = paren + 1;
    let arguments = &css[arguments_start..];
    if arguments.trim_start().starts_with(['"', '\'']) {
        return paren;
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

/// The identifier with its escapes decoded, `\66 oo` and `f\o o` are `foo` and `fo o`
pub(super) fn decode_ident(raw: &str) -> String {
    let mut decoded = String::with_capacity(raw.len());
    let mut index = 0;
    while let Some(character) = raw[index..].chars().next() {
        if character != '\\' {
            decoded.push(character);
            index += character.len_utf8();
            continue;
        }
        let end = escape_end(raw, index);
        let escaped = &raw[index + 1..end];
        let hex = escaped.trim_end_matches(is_css_whitespace);
        if !hex.is_empty() && hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            let character = u32::from_str_radix(hex, 16)
                .ok()
                .and_then(char::from_u32)
                .filter(|character| *character != '\0');
            decoded.push(character.unwrap_or(char::REPLACEMENT_CHARACTER));
        } else {
            decoded.push_str(escaped);
        }
        index = end;
    }
    decoded
}

/// Whether `index` is inside the block opened by the `{` at `brace`
pub(super) fn is_inside_block(css: &str, brace: usize, index: usize) -> bool {
    if css.as_bytes().get(brace) != Some(&b'{') || index <= brace {
        return false;
    }
    let mut depth = 0usize;
    let mut position = brace;
    while position < index.min(css.len()) {
        if let Some(end) = skipped_token_end(css, position) {
            position = end;
            continue;
        }
        match css.as_bytes()[position] {
            b'{' => depth += 1,
            b'}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return false;
                }
            }
            _ => {}
        }
        position += css[position..].chars().next().map_or(1, char::len_utf8);
    }
    depth > 0
}

pub(super) fn is_ident_char(character: char) -> bool {
    character.is_ascii_alphanumeric()
        || character == '-'
        || character == '_'
        || character == '\\'
        || !character.is_ascii()
}
