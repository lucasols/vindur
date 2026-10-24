// Rewrites the classes of compound selectors attached to `&`, like
// `&.active.selected`, `&:hover.active`, `&[data-open].active` or `&:not(.active)`, to their
// hashed classes. Whole class names are matched, so `&.active` doesn't touch `&.activeIcon`
pub(super) fn rewrite_cx_selectors(css: &str, mappings: &[(String, String, bool)]) -> String {
    rewrite_compound_classes(css, &|class_name| {
        mappings
            .iter()
            .find(|(original, _, should_rewrite)| *should_rewrite && original == class_name)
            .map(|(_, hashed, _)| hashed.clone())
    })
}

// Whether `class_name` is one of the classes `rewrite_cx_selectors` would rewrite
pub(super) fn contains_class_selector(css: &str, class_name: &str) -> bool {
    // A marker that can't appear in CSS, so only rewritten occurrences are found
    const MARKER: &str = "\u{0}";
    rewrite_compound_classes(css, &|token| {
        (token == class_name).then(|| MARKER.to_owned())
    })
    .contains(MARKER)
}

type ClassMapper<'m> = dyn Fn(&str) -> Option<String> + 'm;

fn rewrite_compound_classes(css: &str, map: &ClassMapper<'_>) -> String {
    let mut output = String::with_capacity(css.len());
    let mut index = 0;
    while let Some(character) = css[index..].chars().next() {
        if matches!(character, '"' | '\'') || css[index..].starts_with("/*") {
            let end = skipped_end(css, index, css.len());
            output.push_str(&css[index..end]);
            index = end;
        } else if character == '&' {
            output.push('&');
            index = rewrite_compound(css, index + 1, css.len(), &mut output, map);
        } else {
            output.push(character);
            index += character.len_utf8();
        }
    }
    output
}

// Rewrites the `.class` tokens of the compound selector starting at `index`, returning where it
// ends. Scanning never goes past `limit`, the end of the enclosing argument list
fn rewrite_compound(
    css: &str,
    mut index: usize,
    limit: usize,
    output: &mut String,
    map: &ClassMapper<'_>,
) -> usize {
    loop {
        match css[index..limit].chars().next() {
            Some('.') => {
                let token = identifier(&css[index + 1..limit]);
                output.push('.');
                match map(token) {
                    Some(hashed) => output.push_str(&hashed),
                    None => output.push_str(token),
                }
                index += 1 + token.len();
            }
            Some(':') => {
                let name = identifier(&css[index + 1..limit]);
                output.push(':');
                output.push_str(name);
                index += 1 + name.len();
                if css[index..limit].starts_with('(') {
                    // These match the same element, `:has(.x)` or `:nth-child(2 of .x)` don't
                    let same_element = matches!(name, "not" | "is" | "where" | "matches");
                    index = rewrite_arguments(css, index, limit, output, map, same_element);
                }
            }
            Some('[') => {
                let end = skipped_end(css, index, limit);
                output.push_str(&css[index..end]);
                index = end;
            }
            _ => return index,
        }
    }
}

// Rewrites the selector list of a functional pseudo-class. An argument is only rewritten when
// it's a single compound selector, in `:not(.a .b)` the `.a` is another element
fn rewrite_arguments(
    css: &str,
    open: usize,
    limit: usize,
    output: &mut String,
    map: &ClassMapper<'_>,
    rewrite: bool,
) -> usize {
    let end = skipped_end(css, open, limit);
    if !rewrite {
        output.push_str(&css[open..end]);
        return end;
    }
    output.push('(');
    let close = if css[..end].ends_with(')') {
        end - 1
    } else {
        end
    };
    let mut index = open + 1;
    while index < close {
        let whitespace = css[index..close].len() - css[index..close].trim_start().len();
        output.push_str(&css[index..index + whitespace]);
        index += whitespace;
        // Rewritten once into a buffer, rescanning nested arguments would take exponential time
        let mut rewritten = String::new();
        let compound_end = rewrite_compound(css, index, close, &mut rewritten, map);
        let after = css[compound_end..close].trim_start();
        if compound_end > index && (after.is_empty() || after.starts_with(',')) {
            output.push_str(&rewritten);
            index = compound_end;
        }
        let argument_end = next_argument(css, index, close);
        output.push_str(&css[index..argument_end]);
        index = argument_end;
    }
    output.push_str(&css[close..end]);
    end
}

// The end of the next `,`-separated argument, including the `,`
fn next_argument(css: &str, mut index: usize, close: usize) -> usize {
    while let Some(character) = css[index..close].chars().next() {
        if css[index..close].starts_with("/*") {
            index = skipped_end(css, index, close);
            continue;
        }
        match character {
            '"' | '\'' | '(' | '[' => index = skipped_end(css, index, close),
            ',' => return index + 1,
            _ => index += character.len_utf8(),
        }
    }
    close
}

// The end of the string, comment, or balanced `(...)` / `[...]` section starting at `index`,
// never past `limit`
fn skipped_end(css: &str, index: usize, limit: usize) -> usize {
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
            (_, '\\') => {
                position += css[position..limit]
                    .chars()
                    .next()
                    .map_or(0, char::len_utf8);
            }
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

// A CSS identifier, including escapes like `active\:icon`
fn identifier(rest: &str) -> &str {
    let mut characters = rest.char_indices();
    while let Some((index, character)) = characters.next() {
        if character == '\\' {
            characters.next();
        } else if !is_class_name_character(character) {
            return &rest[..index];
        }
    }
    rest
}

fn is_class_name_character(character: char) -> bool {
    character.is_ascii_alphanumeric()
        || character == '_'
        || character == '-'
        || !character.is_ascii()
}
