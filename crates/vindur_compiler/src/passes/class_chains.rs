use super::styled::{STYLED_REF_PREFIX, leading_styled_ref_placeholder};

/// CSS identifiers also accept any non-ASCII character, `$` is the start of a transient flag
fn is_class_name_char(character: char) -> bool {
    !character.is_ascii()
        || character.is_ascii_alphanumeric()
        || matches!(character, '_' | '-' | '$')
}

pub(crate) enum CssToken<'a> {
    Text(&'a str),
    /// A `.class` selector, the component reference it is chained to and its CSS offset
    Class {
        reference: Option<&'a str>,
        name: &'a str,
        offset: usize,
    },
}

/// A selector shape the flags chained to a component reference don't support, with its CSS offset
pub(crate) struct UnsupportedClassChain {
    pub message: &'static str,
    pub offset: usize,
}

const MULTIPLE_REFERENCES_ERROR: &str = "A compound selector can only chain one component reference, like `${Menu}.active`, select each component in its own compound, like `${Menu} ${Item}`";
const REFERENCE_ARGUMENT_ERROR: &str = "`:not()`, `:is()` and `:where()` after a component reference can only list classes of that component, like `${Menu}:not(.active)`, use `:has()` to match other elements";
const CLASS_BEFORE_REFERENCE_ERROR: &str = "A component reference must start its compound selector, like `${Menu}.active`, not `.active${Menu}`";
const FUNCTION_CLASS_ERROR: &str = "After a component reference, only `:not()`, `:is()`, `:where()` and `:has()` can contain classes, like `${Menu}:not(.active)`";
const FUNCTION_REFERENCE_ERROR: &str = "A component reference can't be inside a function like `:is()` or `:not()`, only inside `:has()`, write it directly in the selector, like `${Menu}.active &`";
const NESTED_REFERENCE_ERROR: &str = "`&` nested in a component reference's rule, like `${Menu} { &.active {} }`, can't select classes, write `${Menu}.active` instead";

/// The state of the compound selector being scanned, one per parenthesis level
#[derive(Clone, Copy, Default)]
struct ChainScope<'a> {
    reference: Option<&'a str>,
    /// Inherited by the arguments of `:not()`, `:is()` and `:where()`, which match the same
    /// element as the reference, so they can only list its classes
    inherited: bool,
    /// The arguments of other functions after a reference, like `:nth-child(1 of .active)`, match
    /// other elements, so their classes are rejected
    rejects_classes: bool,
    /// The arguments of functions other than `:has()`, which can't contain component references
    in_function: bool,
    has_class: bool,
    has_ampersand: bool,
    /// The `&` of the compound around a `:not()`, `:is()` or `:where()`
    outer_ampersand: bool,
}

impl ChainScope<'_> {
    fn start_compound(&mut self) {
        self.reference = None;
        self.has_class = false;
        self.has_ampersand = false;
    }
}

struct ClassChainScanner<'a> {
    css: &'a str,
    scopes: Vec<ChainScope<'a>>,
    /// Whether the `&` of each nested rule is a component reference, like in `${Menu} { & {} }`
    reference_rules: Vec<bool>,
    /// Whether an earlier selector of the rule prelude's list, like `${Menu}` in
    /// `${Menu}, .x {}`, ends with a component reference
    prelude_reference: bool,
    prelude_start: usize,
    unsupported: Option<UnsupportedClassChain>,
}

impl<'a> ClassChainScanner<'a> {
    fn scope(&self) -> ChainScope<'a> {
        self.scopes.last().copied().unwrap_or_default()
    }

    fn current(&mut self) -> Option<&mut ChainScope<'a>> {
        self.scopes.last_mut()
    }

    fn in_reference_rule(&self) -> bool {
        self.reference_rules.last().copied().unwrap_or(false)
    }

    /// Whether the `&` of a rule with the current selector is a component reference
    fn selector_is_reference(&self) -> bool {
        let scope = self.scope();
        scope.reference.is_some() || (scope.has_ampersand && self.in_reference_rule())
    }

    fn report(&mut self, message: &'static str, offset: usize) {
        self.unsupported
            .get_or_insert(UnsupportedClassChain { message, offset });
    }

    fn chain_reference(&mut self, reference: &'a str, offset: usize) {
        let scope = self.scope();
        if scope.inherited {
            self.report(REFERENCE_ARGUMENT_ERROR, offset);
        } else if scope.rejects_classes {
            self.report(FUNCTION_CLASS_ERROR, offset);
        } else if scope.in_function {
            self.report(FUNCTION_REFERENCE_ERROR, offset);
        } else if scope.reference.is_some() {
            self.report(MULTIPLE_REFERENCES_ERROR, offset);
        } else if scope.has_class {
            self.report(CLASS_BEFORE_REFERENCE_ERROR, offset);
        } else if let Some(current) = self.current() {
            current.reference = Some(reference);
        }
        if let Some(current) = self.current() {
            current.has_class = true;
        }
    }

    fn class(&mut self, offset: usize) {
        let scope = self.scope();
        if scope.rejects_classes {
            self.report(FUNCTION_CLASS_ERROR, offset);
        } else if scope.reference.is_none()
            && (scope.has_ampersand || scope.outer_ampersand)
            && self.in_reference_rule()
        {
            self.report(NESTED_REFERENCE_ERROR, offset);
        }
        if let Some(current) = self.current() {
            current.has_class = true;
        }
    }

    fn ampersand(&mut self, offset: usize) {
        let scope = self.scope();
        if scope.inherited {
            self.report(REFERENCE_ARGUMENT_ERROR, offset);
        } else if scope.has_class && scope.reference.is_none() && self.in_reference_rule() {
            self.report(NESTED_REFERENCE_ERROR, offset);
        }
        if let Some(current) = self.current() {
            current.has_ampersand = true;
        }
    }

    fn open_function(&mut self, offset: usize) {
        let scope = self.scope();
        let function = css_function_name(&self.css[..offset]);
        let same_element = ["not", "is", "where"]
            .iter()
            .any(|name| function.eq_ignore_ascii_case(name));
        let is_has = function.eq_ignore_ascii_case("has");
        let argument =
            if scope.rejects_classes || (scope.reference.is_some() && !same_element && !is_has) {
                ChainScope {
                    rejects_classes: true,
                    ..ChainScope::default()
                }
            } else if same_element {
                ChainScope {
                    reference: scope.reference,
                    inherited: scope.reference.is_some(),
                    in_function: true,
                    outer_ampersand: scope.has_ampersand || scope.outer_ampersand,
                    ..ChainScope::default()
                }
            } else {
                ChainScope {
                    in_function: !is_has,
                    ..ChainScope::default()
                }
            };
        self.scopes.push(argument);
    }

    /// At-rules like `@media` keep the `&` of their parent rule
    fn open_rule(&mut self, offset: usize) {
        let is_at_rule =
            trim_start_css_comments(&self.css[self.prelude_start..offset]).starts_with('@');
        self.reference_rules.push(if is_at_rule {
            self.in_reference_rule()
        } else {
            self.prelude_reference || self.selector_is_reference()
        });
    }

    fn end_statement(&mut self, offset: usize) {
        self.prelude_reference = false;
        self.scopes.truncate(1);
        if let Some(current) = self.current() {
            current.start_compound();
        }
        self.prelude_start = offset + 1;
    }

    /// Compound boundaries end the reference, inside the arguments of `:not()`, `:is()` and
    /// `:where()` after a reference they select other elements, so they are rejected
    fn separator(&mut self, character: char, offset: usize) {
        let rest = &self.css[offset..];
        if self.scope().inherited {
            if matches!(character, '>' | '+' | '~')
                || (character.is_whitespace() && is_descendant_combinator(self.css, offset))
            {
                self.report(REFERENCE_ARGUMENT_ERROR, offset);
            }
            return;
        }
        if character == ',' && self.scopes.len() == 1 && self.selector_is_reference() {
            self.prelude_reference = true;
        }
        // The spacing before `{` and `,` doesn't end the last compound of a selector
        let ends_compound = matches!(character, ',' | '>' | '+' | '~')
            || (character.is_whitespace()
                && !trim_start_css_comments(rest).starts_with(['{', ',']));
        if ends_compound && let Some(current) = self.current() {
            current.start_compound();
        }
    }

    fn scan_character(&mut self, character: char, offset: usize) {
        match character {
            '&' => self.ampersand(offset),
            '(' => self.open_function(offset),
            ')' if self.scopes.len() > 1 => {
                self.scopes.pop();
            }
            '{' => {
                self.open_rule(offset);
                self.end_statement(offset);
            }
            '}' => {
                if self.reference_rules.len() > 1 {
                    self.reference_rules.pop();
                }
                self.end_statement(offset);
            }
            ';' => self.end_statement(offset),
            _ if character.is_whitespace() || matches!(character, ',' | '>' | '+' | '~') => {
                self.separator(character, offset);
            }
            _ => {}
        }
    }
}

/// Splits CSS into `.class` selectors and the text between them. A class is chained to a
/// component reference (a component class matched by `is_reference` or a forward reference
/// placeholder) when it follows the reference in the same compound selector, e.g. `Parent` for
/// every flag in `.Parent.active.size-small`, `.Parent:hover.active` and `.Parent:not(.active)`.
/// `:has()` matches other elements, so its arguments start a new selector. Comments, strings,
/// attribute selectors and `url()` values are kept as text. Returns the first unsupported selector
/// shape
pub(crate) fn scan_class_chains<'a>(
    css: &'a str,
    is_reference: impl Fn(&str) -> bool,
    mut visit: impl FnMut(CssToken<'a>),
) -> Option<UnsupportedClassChain> {
    let mut scanner = ClassChainScanner {
        css,
        scopes: vec![ChainScope::default()],
        reference_rules: vec![false],
        prelude_reference: false,
        prelude_start: 0,
        unsupported: None,
    };
    let mut rest = css;
    while let Some(character) = rest.chars().next() {
        let offset = css.len() - rest.len();
        if let Some(literal) = leading_css_literal(rest) {
            visit(CssToken::Text(literal));
            rest = &rest[literal.len()..];
            continue;
        }
        if let Some(placeholder) = leading_styled_ref_placeholder(rest) {
            visit(CssToken::Text(placeholder));
            scanner.chain_reference(placeholder, offset);
            rest = &rest[placeholder.len()..];
            continue;
        }
        if character == '.' {
            // A forward reference placeholder right after a class, like in `.x${() => Menu}`,
            // is not part of the class name
            let class_end = rest[1..]
                .find(|character: char| !is_class_name_char(character))
                .map_or(rest.len(), |index| index + 1);
            let class_end = rest[1..class_end]
                .find(STYLED_REF_PREFIX)
                .map_or(class_end, |index| index + 1);
            let name = &rest[1..class_end];
            visit(CssToken::Class {
                reference: scanner.scope().reference,
                name,
                offset,
            });
            if is_reference(name) {
                scanner.chain_reference(name, offset);
            } else {
                scanner.class(offset);
            }
            rest = &rest[class_end..];
            continue;
        }
        scanner.scan_character(character, offset);
        let character_end = character.len_utf8();
        visit(CssToken::Text(&rest[..character_end]));
        rest = &rest[character_end..];
    }
    scanner.unsupported
}

/// The name of the function whose `(` follows `before`, like `not` in `.Parent:not`
fn css_function_name(before: &str) -> &str {
    let start = before
        .rfind(|character: char| !is_class_name_char(character))
        .map_or(0, |index| index + 1);
    &before[start..]
}

/// Whether the whitespace at `offset` separates two selectors, unlike the spacing around `,`, the
/// parentheses and comments
fn is_descendant_combinator(css: &str, offset: usize) -> bool {
    let before = trim_end_css_comments(&css[..offset]);
    let after = trim_start_css_comments(&css[offset..]);
    !before.ends_with(['(', ',']) && !after.starts_with([')', ','])
}

fn trim_start_css_comments(css: &str) -> &str {
    let mut rest = css.trim_start();
    while let Some(comment) = rest.strip_prefix("/*") {
        rest = comment
            .find("*/")
            .map_or("", |end| &comment[end + 2..])
            .trim_start();
    }
    rest
}

fn trim_end_css_comments(css: &str) -> &str {
    let mut rest = css.trim_end();
    while let Some(comment) = rest.strip_suffix("*/") {
        rest = comment
            .rfind("/*")
            .map_or("", |start| &comment[..start])
            .trim_end();
    }
    rest
}

/// A leading comment, string, attribute selector or `url()` value, their content is never a
/// class selector or a compound boundary
fn leading_css_literal(css: &str) -> Option<&str> {
    if let Some(comment) = css.strip_prefix("/*") {
        let end = comment.find("*/").map_or(css.len(), |index| index + 4);
        return Some(&css[..end]);
    }
    if let Some(url) = css.strip_prefix("url(") {
        let argument = url.trim_start();
        let argument_start = css.len() - argument.len();
        let close_search_start = leading_css_string(argument)
            .map_or(argument_start, |string| argument_start + string.len());
        let end = css[close_search_start..]
            .find(')')
            .map_or(css.len(), |index| close_search_start + index + 1);
        return Some(&css[..end]);
    }
    if css.starts_with('[') {
        let mut index = 1;
        while let Some(character) = css[index..].chars().next() {
            if character == ']' {
                return Some(&css[..=index]);
            }
            index += leading_css_string(&css[index..]).map_or(character.len_utf8(), str::len);
        }
        return Some(css);
    }
    leading_css_string(css)
}

/// A leading quoted string, `\` escapes the next character
fn leading_css_string(css: &str) -> Option<&str> {
    let quote = css
        .chars()
        .next()
        .filter(|character| matches!(character, '"' | '\''))?;
    let mut escaped = false;
    let end = css[1..]
        .char_indices()
        .find(|&(_, character)| {
            let is_end = !escaped && character == quote;
            escaped = !escaped && character == '\\';
            is_end
        })
        .map_or(css.len(), |(index, _)| index + 2);
    Some(&css[..end])
}

/// Rewrites each `.class` selector with `rewrite`, which also gets the component reference the
/// class is chained to, see `scan_class_chains`
pub(crate) fn rewrite_class_chains(
    css: &str,
    is_reference: impl Fn(&str) -> bool,
    mut rewrite: impl FnMut(Option<&str>, &str) -> Option<String>,
) -> String {
    let mut output = String::with_capacity(css.len());
    // The shapes are rejected when the template is validated, see `unsupported_class_chain`
    let _ = scan_class_chains(css, is_reference, |token| match token {
        CssToken::Text(text) => output.push_str(text),
        CssToken::Class {
            reference, name, ..
        } => {
            output.push('.');
            match rewrite(reference, name) {
                Some(rewritten) => output.push_str(&rewritten),
                None => output.push_str(name),
            }
        }
    });
    output
}

/// The first selector shape the flags chained to a component reference don't support
pub(crate) fn unsupported_class_chain(
    css: &str,
    is_reference: impl Fn(&str) -> bool,
) -> Option<UnsupportedClassChain> {
    scan_class_chains(css, is_reference, |_| {})
}
