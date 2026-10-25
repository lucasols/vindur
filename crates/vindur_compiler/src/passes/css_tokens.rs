// CSS token helpers shared by the cx selector scanner: strings, comments, balanced sections,
// escapes and identifiers

// The end of the string, comment, or balanced `(...)` / `[...]` section starting at `index`,
// never past `limit`
pub(super) fn skipped_end(css: &str, index: usize, limit: usize) -> usize {
    let rest = &css[index..limit];
    if let Some(comment) = rest.strip_prefix("/*") {
        return comment.find("*/").map_or(limit, |end| index + 2 + end + 2);
    }
    let Some(opening) = rest.chars().next() else {
        return index;
    };
    let is_string = matches!(opening, '"' | '\'');
    let mut position = index + opening.len_utf8();
    let mut depth = 1_usize;
    while let Some(character) = css[position..limit].chars().next() {
        if !is_string && css[position..limit].starts_with("/*") {
            position = skipped_end(css, position, limit);
            continue;
        }
        position += character.len_utf8();
        match (opening, character) {
            (_, '\\') => position = escape_end(css, position - 1, limit),
            ('"' | '\'', quote) if quote == opening => return position,
            ('"' | '\'', _) => {}
            (_, '"' | '\'') => position = skipped_end(css, position - 1, limit),
            ('(', '(') | ('[', '[') => depth += 1,
            ('(', ')') | ('[', ']') => {
                depth -= 1;
                if depth == 0 {
                    return position;
                }
            }
            _ => {}
        }
    }
    limit
}

// A leading `*` or element name, like the `div` of `div.active`
pub(super) fn type_selector(rest: &str) -> &str {
    if rest.starts_with('*') {
        return &rest[..1];
    }
    if rest.starts_with(|character: char| character.is_ascii_alphabetic()) {
        return identifier(rest);
    }
    ""
}

// A CSS identifier, including escapes like `active\:icon` or `md\3a active`
pub(super) fn identifier(rest: &str) -> &str {
    let mut index = 0;
    while let Some(character) = rest[index..].chars().next() {
        index = if character == '\\' {
            escape_end(rest, index, rest.len())
        } else if is_class_name_character(character) {
            index + character.len_utf8()
        } else {
            break;
        };
    }
    &rest[..index]
}

// The end of the escape at the `\` at `index`: up to 6 hex digits and the whitespace that may
// end them, or a single character (CSS Syntax 4.3.7)
pub(super) fn escape_end(css: &str, index: usize, limit: usize) -> usize {
    let rest = &css[index + 1..limit];
    let hex_digits = rest
        .bytes()
        .take(6)
        .take_while(u8::is_ascii_hexdigit)
        .count();
    if hex_digits == 0 {
        return index + 1 + rest.chars().next().map_or(0, char::len_utf8);
    }
    let after = &rest[hex_digits..];
    let whitespace = if after.starts_with("\r\n") {
        2
    } else {
        usize::from(after.starts_with([' ', '\t', '\n', '\r', '\u{c}']))
    };
    index + 1 + hex_digits + whitespace
}

fn is_class_name_character(character: char) -> bool {
    character.is_ascii_alphanumeric()
        || character == '_'
        || character == '-'
        || !character.is_ascii()
}

// The value of a CSS identifier, `md\:active` or `md\3a active` is `md:active`
pub(super) fn unescape(identifier: &str) -> String {
    let mut value = String::with_capacity(identifier.len());
    let mut characters = identifier.chars().peekable();
    while let Some(character) = characters.next() {
        if character != '\\' {
            value.push(character);
            continue;
        }
        let mut hex = String::new();
        while hex.len() < 6
            && let Some(digit) = characters.next_if(char::is_ascii_hexdigit)
        {
            hex.push(digit);
        }
        if hex.is_empty() {
            value.extend(characters.next());
        } else {
            if characters.next_if_eq(&'\r').is_some() {
                characters.next_if_eq(&'\n');
            } else {
                characters.next_if(|next| matches!(next, ' ' | '\t' | '\n' | '\u{c}'));
            }
            let code_point = u32::from_str_radix(&hex, 16).unwrap_or(0xFFFD);
            value.push(char::from_u32(code_point).unwrap_or('\u{FFFD}'));
        }
    }
    value
}

// `class_name` as a CSS identifier, like `md:active` as `md\:active`
pub(super) fn css_escape(class_name: &str) -> String {
    let mut escaped = String::with_capacity(class_name.len());
    for character in class_name.chars() {
        if is_class_name_character(character) {
            escaped.push(character);
        } else if character.is_whitespace() || character.is_control() {
            escaped.push_str(&format!("\\{:x} ", u32::from(character)));
        } else {
            escaped.push('\\');
            escaped.push(character);
        }
    }
    escaped
}
