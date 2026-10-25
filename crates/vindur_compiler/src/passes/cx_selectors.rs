// Rewrites the classes of the compound selectors that match the styled element, like
// `&.active.selected`, `&:hover.active`, `&[data-open].active`, `.active&` or
// `&:not(div.active)` or `@scope (&.active)`, to their hashed classes. Whole class names are
// matched, so `&.active` doesn't touch `&.activeIcon`, and escaped classes like `&.md\:active`
// match the `md:active` key. Rules nested under a rule that clearly targets another element, like the `&.selected`
// of `& .tab { &.selected {} }`, are left alone
//
// `css` holds whole rules like `.v1-Box { ... }`
pub(super) fn rewrite_cx_selectors(css: &str, mappings: &[(String, String, bool)]) -> String {
    rewrite_rules(css, &mapping_class(mappings), RuleContext::TopLevel)
}

// Like `rewrite_cx_selectors`, for the declarations and nested rules of a single rule
pub(super) fn rewrite_cx_selectors_in_body(
    css: &str,
    mappings: &[(String, String, bool)],
) -> String {
    rewrite_rules(css, &mapping_class(mappings), RuleContext::StyledElement)
}

// Whether `class_name` is one of the classes `rewrite_cx_selectors` would rewrite
pub(super) fn contains_class_selector(css: &str, class_name: &str) -> bool {
    // A marker that can't appear in CSS, so only rewritten occurrences are found
    const MARKER: &str = "\u{0}";
    rewrite_rules(
        css,
        &|token| (token == class_name).then(|| MARKER.to_owned()),
        RuleContext::TopLevel,
    )
    .contains(MARKER)
}

type ClassMapper<'m> = dyn Fn(&str) -> Option<String> + 'm;

fn mapping_class(mappings: &[(String, String, bool)]) -> impl Fn(&str) -> Option<String> + '_ {
    |class_name| {
        mappings
            .iter()
            .find(|(original, _, should_rewrite)| *should_rewrite && original == class_name)
            .map(|(_, hashed, _)| css_escape(hashed))
    }
}

// What `&` refers to inside a block
#[derive(Clone, Copy, PartialEq, Eq)]
enum RuleContext {
    // Outside the styled element's rule, where selectors like `.v1-Box` start it
    TopLevel,
    // Inside the styled element's rule, or a rule nested in it that still matches it
    StyledElement,
    // Inside a rule that clearly targets another element, like `& .tab { ... }`
    OtherElement,
}

// Rewrites the selectors of the rules in `css`, copying declarations and at-rule preludes
fn rewrite_rules(css: &str, map: &ClassMapper<'_>, initial: RuleContext) -> String {
    let mut output = String::with_capacity(css.len());
    let mut contexts = vec![initial];
    let mut index = 0;
    while index < css.len() {
        let end = segment_end(css, index);
        let context = contexts.last().copied().unwrap_or(initial);
        match css[end..].chars().next() {
            Some('{') => {
                let prelude = &css[skip_trivia(css, index, end)..end];
                let is_at_rule = prelude.starts_with('@');
                let is_scope =
                    is_at_rule && identifier(&prelude[1..]).eq_ignore_ascii_case("scope");
                if context != RuleContext::StyledElement || (is_at_rule && !is_scope) {
                    output.push_str(&css[index..end]);
                } else if is_scope {
                    rewrite_scope_prelude(css, index, end, &mut output, map);
                } else {
                    rewrite_selector_list(css, index, end, &mut output, map, false);
                }
                contexts.push(match context {
                    _ if is_at_rule => context,
                    RuleContext::TopLevel => RuleContext::StyledElement,
                    RuleContext::StyledElement if nested_rule_matches_parent(css, index, end) => {
                        RuleContext::StyledElement
                    }
                    RuleContext::StyledElement | RuleContext::OtherElement => {
                        RuleContext::OtherElement
                    }
                });
            }
            Some('}') => {
                if contexts.len() > 1 {
                    contexts.pop();
                }
                output.push_str(&css[index..end]);
            }
            _ => output.push_str(&css[index..end]),
        }
        index = (end + 1).min(css.len());
        output.push_str(&css[end..index]);
    }
    output
}

// The position of the next `{`, `}` or `;` outside strings, comments, escapes and balanced
// `(...)` / `[...]` sections, or the end of `css`
fn segment_end(css: &str, mut index: usize) -> usize {
    while let Some(character) = css[index..].chars().next() {
        index = match character {
            '{' | '}' | ';' => return index,
            '"' | '\'' | '(' | '[' => skipped_end(css, index, css.len()),
            '/' if css[index..].starts_with("/*") => skipped_end(css, index, css.len()),
            '\\' => escape_end(css, index, css.len()),
            _ => index + character.len_utf8(),
        };
    }
    css.len()
}

// Whether a nested rule may still match the parent's element. Only a prelude whose selectors
// all clearly target another element doesn't, so anything uncertain, like `.tab`, `:is(&)` or
// `&:hover, & .tab`, keeps rewriting the modifiers as before nesting was tracked
fn nested_rule_matches_parent(css: &str, start: usize, end: usize) -> bool {
    let mut index = start;
    let mut has_selector = false;
    while index < end {
        let argument_end = next_argument(css, index, end);
        let content_end = if css[index..argument_end].ends_with(',') {
            argument_end - 1
        } else {
            argument_end
        };
        if !targets_other_element(css, index, content_end) {
            return true;
        }
        has_selector = true;
        index = argument_end;
    }
    !has_selector
}

// Rewrites the `&` compounds of the `(root) to (limit)` selectors of an `@scope` prelude
fn rewrite_scope_prelude(
    css: &str,
    mut index: usize,
    end: usize,
    output: &mut String,
    map: &ClassMapper<'_>,
) {
    while let Some(character) = css[index..end].chars().next() {
        let next = match character {
            '(' => {
                index = rewrite_arguments(css, index, end, output, map, "scope", false);
                continue;
            }
            '"' | '\'' | '[' => skipped_end(css, index, end),
            '/' if css[index..end].starts_with("/*") => skipped_end(css, index, end),
            '\\' => escape_end(css, index, end),
            _ => index + character.len_utf8(),
        };
        output.push_str(&css[index..next]);
        index = next;
    }
}

// Whether a selector clearly targets another element: a `&` before its last compound and none
// in that compound, like `& .tab` or `& > .icon`
fn targets_other_element(css: &str, start: usize, end: usize) -> bool {
    let compounds = compound_ranges(css, start, end);
    let Some((&(subject_start, subject_end), ancestors)) = compounds.split_last() else {
        return false;
    };
    !contains_ampersand(css, subject_start, subject_end, true)
        && ancestors.iter().any(|&(compound_start, compound_end)| {
            contains_ampersand(css, compound_start, compound_end, false)
        })
}

// The position after the whitespace and comments starting at `index`
fn skip_trivia(css: &str, mut index: usize, end: usize) -> usize {
    while let Some(character) = css[index..end].chars().next() {
        index = if css[index..end].starts_with("/*") {
            skipped_end(css, index, end)
        } else if character.is_whitespace() {
            index + character.len_utf8()
        } else {
            return index;
        };
    }
    end
}

// Whether the compound between `start` and `end` has a `&` outside strings, comments, escapes
// and attribute selectors, and outside its pseudo-class arguments unless `in_arguments`
fn contains_ampersand(css: &str, start: usize, end: usize, in_arguments: bool) -> bool {
    let mut index = start;
    while let Some(character) = css[index..end].chars().next() {
        index = match character {
            '&' => return true,
            '(' if in_arguments => index + 1,
            '"' | '\'' | '(' | '[' => skipped_end(css, index, end),
            '/' if css[index..end].starts_with("/*") => skipped_end(css, index, end),
            '\\' => escape_end(css, index, end),
            _ => index + character.len_utf8(),
        };
    }
    false
}

// Rewrites the compound selector starting at `index`, returning where it ends. Its `.class`
// tokens are rewritten when it matches the styled element (`rewrite_classes`). Scanning never
// goes past `limit`, the end of the enclosing argument list
fn rewrite_compound(
    css: &str,
    mut index: usize,
    limit: usize,
    output: &mut String,
    map: &ClassMapper<'_>,
    rewrite_classes: bool,
) -> usize {
    let type_name = type_selector(&css[index..limit]);
    output.push_str(type_name);
    index += type_name.len();
    loop {
        match css[index..limit].chars().next() {
            Some('&') => {
                output.push('&');
                index += 1;
            }
            Some('.') => {
                let token = identifier(&css[index + 1..limit]);
                output.push('.');
                match rewrite_classes.then(|| map(&unescape(token))).flatten() {
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
                    index =
                        rewrite_arguments(css, index, limit, output, map, name, rewrite_classes);
                }
            }
            Some('#') => {
                let id = identifier(&css[index + 1..limit]);
                output.push('#');
                output.push_str(id);
                index += 1 + id.len();
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

// Rewrites the arguments of the functional pseudo-class `name`, starting at its `(`. The
// subject of `:not`, `:is`, `:where` and of the `of S` list of `:nth-child` is the element of
// the compound they're in, so their classes are rewritten when that compound matches the
// styled element. Other arguments like `:has(.x)` only have their `&` compounds rewritten
fn rewrite_arguments(
    css: &str,
    open: usize,
    limit: usize,
    output: &mut String,
    map: &ClassMapper<'_>,
    name: &str,
    compound_matches: bool,
) -> usize {
    let end = skipped_end(css, open, limit);
    let close = if css[open..end].ends_with(')') {
        end - 1
    } else {
        end
    };
    output.push('(');
    let start = open + 1;
    match name.to_ascii_lowercase().as_str() {
        "not" | "is" | "where" | "matches" => {
            rewrite_selector_list(css, start, close, output, map, compound_matches);
        }
        "nth-child" | "nth-last-child" => match nth_selector_start(css, start, close) {
            Some(selectors) => {
                rewrite_selector_list(css, start, selectors, output, map, false);
                rewrite_selector_list(css, selectors, close, output, map, compound_matches);
            }
            None => rewrite_selector_list(css, start, close, output, map, false),
        },
        _ => rewrite_selector_list(css, start, close, output, map, false),
    }
    output.push_str(&css[close..end]);
    end
}

// Rewrites each `,`-separated selector between `start` and `end`
fn rewrite_selector_list(
    css: &str,
    start: usize,
    end: usize,
    output: &mut String,
    map: &ClassMapper<'_>,
    same_element: bool,
) {
    let mut index = start;
    while index < end {
        let argument_end = next_argument(css, index, end);
        let content_end = if css[index..argument_end].ends_with(',') {
            argument_end - 1
        } else {
            argument_end
        };
        rewrite_complex_selector(css, index, content_end, output, map, same_element);
        output.push_str(&css[content_end..argument_end]);
        index = argument_end;
    }
}

// Compounds with a `&` match the styled element. So does the subject, the last compound, when
// `same_element`: in `:not(.parent .active)` only `.active` is the current element
fn rewrite_complex_selector(
    css: &str,
    start: usize,
    end: usize,
    output: &mut String,
    map: &ClassMapper<'_>,
    same_element: bool,
) {
    let compounds = compound_ranges(css, start, end);
    let mut index = start;
    for (position, &(compound_start, compound_end)) in compounds.iter().enumerate() {
        output.push_str(&css[index..compound_start]);
        let matches = (same_element && position + 1 == compounds.len())
            || contains_ampersand(css, compound_start, compound_end, false);
        rewrite_compound_range(css, compound_start, compound_end, output, map, matches);
        index = compound_end;
    }
    output.push_str(&css[index..end]);
}

// Rewrites a compound, copying the parts that aren't selector syntax, like the `2n` of
// `:nth-child(2n+1)`, and strings, comments and escapes as they are
fn rewrite_compound_range(
    css: &str,
    start: usize,
    end: usize,
    output: &mut String,
    map: &ClassMapper<'_>,
    rewrite_classes: bool,
) {
    let mut index = start;
    while let Some(character) = css[index..end].chars().next() {
        let next = if matches!(character, '"' | '\'') || css[index..end].starts_with("/*") {
            skipped_end(css, index, end)
        } else if character == '\\' {
            escape_end(css, index, end)
        } else {
            let next = rewrite_compound(css, index, end, output, map, rewrite_classes);
            if next > index {
                index = next;
                continue;
            }
            index + character.len_utf8()
        };
        output.push_str(&css[index..next]);
        index = next;
    }
}

// The ranges of the compound selectors between `start` and `end`, separated by whitespace and
// the `>`, `+` and `~` combinators. Comments don't split a compound, `&/* c */.active` is one
fn compound_ranges(css: &str, start: usize, end: usize) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut compound_start = None;
    let mut index = start;
    while let Some(character) = css[index..end].chars().next() {
        if css[index..end].starts_with("/*") {
            index = skipped_end(css, index, end);
            continue;
        }
        if character.is_whitespace() || matches!(character, '>' | '+' | '~') {
            if let Some(range_start) = compound_start.take() {
                ranges.push((range_start, index));
            }
            index += character.len_utf8();
            continue;
        }
        compound_start.get_or_insert(index);
        index = match character {
            '"' | '\'' | '(' | '[' => skipped_end(css, index, end),
            '\\' => escape_end(css, index, end),
            _ => index + character.len_utf8(),
        };
    }
    if let Some(range_start) = compound_start {
        ranges.push((range_start, end));
    }
    ranges
}

// Where the selector list of `:nth-child(An+B of S)` starts, right after `of`
fn nth_selector_start(css: &str, start: usize, end: usize) -> Option<usize> {
    let mut index = start;
    let mut after_whitespace = false;
    while let Some(character) = css[index..end].chars().next() {
        if after_whitespace
            && css[index..end].starts_with("of")
            && css[index + 2..end].starts_with(char::is_whitespace)
        {
            return Some(index + 2);
        }
        after_whitespace = character.is_whitespace();
        index = match character {
            '"' | '\'' | '(' | '[' => skipped_end(css, index, end),
            _ => index + character.len_utf8(),
        };
    }
    None
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
fn type_selector(rest: &str) -> &str {
    if rest.starts_with('*') {
        return &rest[..1];
    }
    if rest.starts_with(|character: char| character.is_ascii_alphabetic()) {
        return identifier(rest);
    }
    ""
}

// A CSS identifier, including escapes like `active\:icon` or `md\3a active`
fn identifier(rest: &str) -> &str {
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
fn escape_end(css: &str, index: usize, limit: usize) -> usize {
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
fn unescape(identifier: &str) -> String {
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
fn css_escape(class_name: &str) -> String {
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
