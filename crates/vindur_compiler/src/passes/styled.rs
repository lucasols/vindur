use oxc_ast::ast::{
    Argument, CallExpression, Expression, JSXElement, JSXFragment, ObjectExpression, Program,
    Statement, TSTypeParameterInstantiation, TaggedTemplateExpression,
};
use oxc_ast_visit::{Visit, walk};
use oxc_span::{GetSpan, Span};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{CompilerDiagnostic, semantic::VindurImports};

use super::css::{hex_decode, hex_encode};
use super::style_flags::extract_style_flags;
use super::vindur_fn_references::{is_styled_tag, is_vindur_template_tag};

#[derive(Clone, Debug)]
pub(crate) enum StyleFlagKind {
    Boolean,
    StringUnion(Vec<String>),
}

#[derive(Clone, Debug)]
pub(crate) struct StyleFlag {
    pub hashed_class_name: String,
    pub kind: StyleFlagKind,
    pub prop_name: String,
    /// The flag property in the style flags type
    pub span: Span,
}

/// JS identifiers can contain `$`, which is not valid in a CSS class name
pub(crate) fn css_class_name_part(name: &str) -> String {
    name.replace('$', "_")
}

#[derive(Clone, Debug)]
pub(crate) struct StyledComponent {
    pub attrs: Option<String>,
    pub class_name: String,
    pub element: String,
    pub element_is_identifier: bool,
    pub runtime: bool,
    pub style_flags: Vec<StyleFlag>,
}

pub(crate) struct StyledDefinition {
    pub attrs: Option<String>,
    pub base_component: StyledComponent,
    pub style_flags: Vec<StyleFlag>,
}

pub(crate) struct StyledTagContext<'a> {
    pub class_name: &'a str,
    pub components: &'a FxHashMap<String, StyledComponent>,
    pub dev: bool,
    pub file_path: &'a str,
    pub imports: &'a VindurImports<'a>,
    pub program: &'a Program<'a>,
    pub source: &'a str,
}

pub(crate) fn styled_tag_element(
    tag: &Expression<'_>,
    imports: &VindurImports<'_>,
) -> Option<String> {
    let Expression::StaticMemberExpression(member) = tag else {
        return None;
    };
    let Expression::Identifier(object) = &member.object else {
        return None;
    };
    if !imports.matches_import_or_global(object, "styled") {
        return None;
    }
    Some(member.property.name.to_string())
}

pub(crate) fn styled_tag_component(
    tag: &Expression<'_>,
    imports: &VindurImports<'_>,
    components: &FxHashMap<String, StyledComponent>,
) -> Option<StyledComponent> {
    if let Some(element) = styled_tag_element(tag, imports) {
        return Some(StyledComponent {
            attrs: None,
            class_name: String::new(),
            element,
            element_is_identifier: false,
            runtime: false,
            style_flags: Vec::new(),
        });
    }
    let Expression::CallExpression(call) = tag else {
        return None;
    };
    let Expression::Identifier(callee) = &call.callee else {
        return None;
    };
    if !imports.matches_import_or_global(callee, "styled") {
        return None;
    }
    let [argument] = call.arguments.as_slice() else {
        return None;
    };
    match argument {
        Argument::Identifier(base) => Some(
            components
                .get(base.name.as_str())
                .cloned()
                .unwrap_or_else(|| StyledComponent {
                    attrs: None,
                    class_name: String::new(),
                    element: base.name.to_string(),
                    element_is_identifier: true,
                    runtime: false,
                    style_flags: Vec::new(),
                }),
        ),
        Argument::StaticMemberExpression(member) => {
            let Expression::Identifier(object) = &member.object else {
                return None;
            };
            Some(StyledComponent {
                attrs: None,
                class_name: String::new(),
                element: format!("{}.{}", object.name, member.property.name),
                element_is_identifier: true,
                runtime: false,
                style_flags: Vec::new(),
            })
        }
        _ => None,
    }
}

pub(crate) fn styled_tag_component_with_attrs(
    tag: &Expression<'_>,
    type_arguments: Option<&TSTypeParameterInstantiation<'_>>,
    context: &StyledTagContext<'_>,
) -> Result<Option<StyledDefinition>, CompilerDiagnostic> {
    let style_flags = match type_arguments {
        Some(type_arguments) => extract_style_flags(
            &type_arguments.params,
            context.dev,
            context.class_name,
            context.program,
            context.file_path,
            context.source,
        )?,
        None => Vec::new(),
    };
    if let Expression::CallExpression(call) = tag
        && let Expression::StaticMemberExpression(member) = &call.callee
        && member.property.name.as_str() == "attrs"
        && let Some(component) =
            styled_tag_component(&member.object, context.imports, context.components)
    {
        let [Argument::ObjectExpression(object)] = call.arguments.as_slice() else {
            return Err(CompilerDiagnostic::error(
                context.file_path,
                context.source,
                call.span,
                "styled.*.attrs() must be called with exactly one object literal argument"
                    .to_owned(),
            ));
        };
        // The object is copied as written, so it can't hold code the other passes rewrite
        if let Some((span, message)) = first_unsupported_attrs_value(object, context.imports) {
            return Err(CompilerDiagnostic::error(
                context.file_path,
                context.source,
                span,
                message.to_owned(),
            ));
        }
        let span = object.span;
        return Ok(Some(StyledDefinition {
            base_component: component,
            attrs: Some(context.source[span.start as usize..span.end as usize].to_owned()),
            style_flags,
        }));
    }
    let component = styled_tag_component(tag, context.imports, context.components);
    if let Expression::CallExpression(call) = tag
        && let Expression::Identifier(callee) = &call.callee
        && context.imports.matches_import_or_global(callee, "styled")
        && let [Argument::Identifier(base)] = call.arguments.as_slice()
    {
        let name = base.name.as_str();
        if !name.chars().next().is_some_and(char::is_uppercase) {
            return Err(CompilerDiagnostic::error(
                context.file_path,
                context.source,
                base.span,
                format!(
                    "Cannot extend \"{name}\": component names must start with an uppercase letter (CamelCase)."
                ),
            ));
        }
        if !context.components.contains_key(name)
            && local_non_component_binding(context.program, name)
        {
            return Err(CompilerDiagnostic::error(
                context.file_path,
                context.source,
                base.span,
                format!("Cannot extend \"{name}\": it is not a component or styled component."),
            )
            .ignored_in_lint());
        }
    }
    let Some(component) = component else {
        if is_styled_tag(tag, context.imports) {
            return Err(CompilerDiagnostic::error(
                context.file_path,
                context.source,
                tag.span(),
                unsupported_styled_tag_message(tag).to_owned(),
            ));
        }
        return Ok(None);
    };
    Ok(Some(StyledDefinition {
        attrs: None,
        base_component: component,
        style_flags,
    }))
}

fn unsupported_styled_tag_message(tag: &Expression<'_>) -> &'static str {
    if let Expression::CallExpression(call) = tag
        && let Expression::StaticMemberExpression(member) = &call.callee
        && member.property.name.as_str() == "attrs"
        && let Expression::CallExpression(inner) = &member.object
        && matches!(&inner.callee, Expression::StaticMemberExpression(inner_member) if inner_member.property.name.as_str() == "attrs")
    {
        return "Chained .attrs() calls are not supported, combine them into a single .attrs({...}) object";
    }
    "Unsupported styled component definition, use styled.tag`...`, styled(Component)`...` or add a single .attrs({...}) to them"
}

fn local_non_component_binding(program: &Program<'_>, expected: &str) -> bool {
    program.body.iter().any(|statement| {
        let Statement::VariableDeclaration(declaration) = statement else {
            return false;
        };
        declaration.declarations.iter().any(|declarator| {
            declarator
                .id
                .get_binding_identifier()
                .is_some_and(|identifier| identifier.name.as_str() == expected)
                && declarator.init.as_ref().is_some_and(|initializer| {
                    !matches!(
                        initializer,
                        Expression::ArrowFunctionExpression(_)
                            | Expression::FunctionExpression(_)
                            | Expression::ClassExpression(_)
                    )
                })
        })
    })
}

pub(crate) fn resolve_styled_references(
    css_rules: &mut [String],
    components: &FxHashMap<String, StyledComponent>,
) -> Option<String> {
    let mut references = FxHashMap::default();
    for (name, component) in components {
        references.insert(styled_ref_placeholder(name), component);
        if let Some(class_name) = component.class_name.split_whitespace().last() {
            references.insert(class_name.to_owned(), component);
        }
    }
    for rule in css_rules.iter_mut() {
        // Styled components already rewrote the flags chained to the components defined before
        // them, see `rewrite_style_flag_selectors`, this also covers `css` and forward references
        *rule = rewrite_class_chains(
            rule,
            |class| references.contains_key(class),
            |reference, class| {
                let component = references.get(reference?)?;
                style_flag_class(&component.style_flags, class)
            },
        );
        for (name, component) in components {
            let Some(class_name) = component.class_name.split_whitespace().last() else {
                continue;
            };
            *rule = rule.replace(&styled_ref_placeholder(name), &format!(".{class_name}"));
        }
    }
    css_rules.iter().find_map(|rule| {
        let (_, suffix) = rule.split_once(STYLED_REF_PREFIX)?;
        let (encoded, _) = suffix.split_once(STYLED_REF_SUFFIX)?;
        hex_decode(encoded)
    })
}

/// The generated class of a flag selector like `active` or `size-small`
pub(crate) fn style_flag_class(flags: &[StyleFlag], selector: &str) -> Option<String> {
    flags.iter().find_map(|flag| match &flag.kind {
        StyleFlagKind::Boolean => {
            (flag.prop_name == selector).then(|| flag.hashed_class_name.clone())
        }
        StyleFlagKind::StringUnion(values) => {
            let value = selector
                .strip_prefix(flag.prop_name.as_str())?
                .strip_prefix('-')?;
            values
                .iter()
                .any(|declared| declared == value)
                .then(|| format!("{}-{value}", flag.hashed_class_name))
        }
    })
}

/// CSS identifiers also accept any non-ASCII character, `$` is the start of a transient flag
fn is_class_name_char(character: char) -> bool {
    !character.is_ascii()
        || character.is_ascii_alphanumeric()
        || matches!(character, '_' | '-' | '$')
}

enum CssToken<'a> {
    Text(&'a str),
    /// A `.class` selector and the component reference it is chained to
    Class {
        reference: Option<&'a str>,
        name: &'a str,
    },
}

/// A selector shape the flags chained to a component reference don't support, with its CSS offset
pub(crate) struct UnsupportedClassChain {
    pub message: &'static str,
    pub offset: usize,
}

const MULTIPLE_REFERENCES_ERROR: &str = "A compound selector can only chain one component reference, like `${Menu}.active`, select each component in its own compound, like `${Menu} ${Item}`";
const REFERENCE_ARGUMENT_ERROR: &str = "`:not()`, `:is()` and `:where()` after a component reference can only list classes of that component, like `${Menu}:not(.active)`, use `:has()` to match other elements";

/// The component reference of the compound selector being scanned, one per parenthesis level
#[derive(Clone, Copy)]
struct ChainScope<'a> {
    reference: Option<&'a str>,
    /// Inherited by the arguments of `:not()`, `:is()` and `:where()`, which match the same
    /// element as the reference, so they can only list its classes
    inherited: bool,
}

/// Splits CSS into `.class` selectors and the text between them. A class is chained to a
/// component reference (a component class matched by `is_reference` or a forward reference
/// placeholder) when it is in the same compound selector, e.g. `Parent` for every flag in
/// `.Parent.active.size-small`, `.Parent:hover.active` and `.Parent:not(.active)`. `:has()`
/// matches other elements, so its arguments start a new selector. Comments, strings and `url()`
/// values are kept as text. Returns the first unsupported selector shape
fn scan_class_chains<'a>(
    css: &'a str,
    is_reference: impl Fn(&str) -> bool,
    mut visit: impl FnMut(CssToken<'a>),
) -> Option<UnsupportedClassChain> {
    let top_level = ChainScope {
        reference: None,
        inherited: false,
    };
    let mut scopes = vec![top_level];
    let mut unsupported = None;
    let mut report = |message: &'static str, rest: &str| {
        unsupported.get_or_insert(UnsupportedClassChain {
            message,
            offset: css.len() - rest.len(),
        });
    };
    let mut rest = css;
    while let Some(character) = rest.chars().next() {
        let scope = scopes.last().copied().unwrap_or(top_level);
        if let Some(literal) = leading_css_literal(rest) {
            visit(CssToken::Text(literal));
            rest = &rest[literal.len()..];
            continue;
        }
        let (reference, token_end) = match leading_styled_ref_placeholder(rest) {
            Some(placeholder) => {
                visit(CssToken::Text(placeholder));
                (Some(placeholder), placeholder.len())
            }
            None if character == '.' => {
                let class_end = rest[1..]
                    .find(|character: char| !is_class_name_char(character))
                    .map_or(rest.len(), |index| index + 1);
                let name = &rest[1..class_end];
                visit(CssToken::Class {
                    reference: scope.reference,
                    name,
                });
                (is_reference(name).then_some(name), class_end)
            }
            None => (None, 0),
        };
        if token_end > 0 {
            if let Some(reference) = reference {
                if scope.inherited {
                    report(REFERENCE_ARGUMENT_ERROR, rest);
                } else if scope.reference.is_some() {
                    report(MULTIPLE_REFERENCES_ERROR, rest);
                } else if let Some(current) = scopes.last_mut() {
                    current.reference = Some(reference);
                }
            }
            rest = &rest[token_end..];
            continue;
        }
        match character {
            '(' => {
                let function = css_function_name(&css[..css.len() - rest.len()]);
                let inherits =
                    scope.reference.is_some() && matches!(function, "not" | "is" | "where");
                scopes.push(ChainScope {
                    reference: scope.reference.filter(|_| inherits),
                    inherited: inherits,
                });
            }
            ')' if scopes.len() > 1 => {
                scopes.pop();
            }
            '{' | '}' | ';' => scopes.truncate(1),
            _ => {}
        }
        if scope.inherited {
            if matches!(character, '&' | '>' | '+' | '~')
                || (character.is_whitespace() && is_descendant_combinator(css, rest))
            {
                report(REFERENCE_ARGUMENT_ERROR, rest);
            }
        } else if u8::try_from(character).is_ok_and(is_compound_boundary)
            && let Some(current) = scopes.last_mut()
        {
            current.reference = None;
        }
        let character_end = character.len_utf8();
        visit(CssToken::Text(&rest[..character_end]));
        rest = &rest[character_end..];
    }
    unsupported
}

/// The name of the function whose `(` follows `before`, like `not` in `.Parent:not`
fn css_function_name(before: &str) -> &str {
    let start = before
        .rfind(|character: char| !is_class_name_char(character))
        .map_or(0, |index| index + 1);
    &before[start..]
}

/// Whether the whitespace starting `rest` separates two selectors, unlike the spacing around
/// `,` and the parentheses
fn is_descendant_combinator(css: &str, rest: &str) -> bool {
    let before = css[..css.len() - rest.len()].trim_end();
    let after = rest.trim_start();
    !before.ends_with(['(', ',']) && !after.starts_with([')', ','])
}

/// A leading comment, string or `url()` value, their content is never a selector
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
        CssToken::Class { reference, name } => {
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

pub(crate) fn is_styled_ref_placeholder(reference: &str) -> bool {
    reference.starts_with(STYLED_REF_PREFIX)
}

fn leading_styled_ref_placeholder(css: &str) -> Option<&str> {
    let encoded = css.strip_prefix(STYLED_REF_PREFIX)?;
    let encoded_end = encoded.find(STYLED_REF_SUFFIX)?;
    Some(&css[..STYLED_REF_PREFIX.len() + encoded_end + STYLED_REF_SUFFIX.len()])
}

const STYLED_REF_PREFIX: &str = "__VINDUR_STYLED_REF_";
const STYLED_REF_SUFFIX: &str = "__";

/// Forward styled component references are replaced by a placeholder until every component is
/// known, the name is hex encoded because JS identifiers can contain `$`, which CSS rejects
pub(crate) fn styled_ref_placeholder(name: &str) -> String {
    format!("{STYLED_REF_PREFIX}{}{STYLED_REF_SUFFIX}", hex_encode(name))
}

/// Flags chained to another component, like `${Parent}.active`, are not styles of the component
pub(crate) fn missing_style_flag_selectors(
    css: &str,
    flags: &[StyleFlag],
    is_reference: impl Fn(&str) -> bool,
) -> Vec<String> {
    let css = strip_css_comments(css);
    let mut own_classes = FxHashSet::default();
    let _ = scan_class_chains(&css, is_reference, |token| {
        if let CssToken::Class {
            reference: None,
            name,
        } = token
        {
            own_classes.insert(name);
        }
    });
    let mut missing = Vec::new();
    for flag in flags {
        match &flag.kind {
            StyleFlagKind::Boolean => {
                if !own_classes.contains(flag.prop_name.as_str())
                    && !own_classes.contains(flag.hashed_class_name.as_str())
                {
                    missing.push(format!("&.{}", flag.prop_name));
                }
            }
            StyleFlagKind::StringUnion(values) => {
                for value in values {
                    let original = format!("{}-{value}", flag.prop_name);
                    let hashed = format!("{}-{value}", flag.hashed_class_name);
                    if !own_classes.contains(original.as_str())
                        && !own_classes.contains(hashed.as_str())
                    {
                        missing.push(format!("&.{original}"));
                    }
                }
            }
        }
    }
    missing
}

pub(crate) fn undeclared_style_classes(css: &str, flags: &[StyleFlag]) -> Vec<String> {
    let css = strip_css_comments(css);
    let declared = flags
        .iter()
        .flat_map(|flag| match &flag.kind {
            StyleFlagKind::Boolean => vec![flag.prop_name.clone()],
            StyleFlagKind::StringUnion(values) => values
                .iter()
                .map(|value| format!("{}-{value}", flag.prop_name))
                .collect(),
        })
        .collect::<FxHashSet<_>>();
    let mut classes: Vec<String> = Vec::new();
    for name in ampersand_compound_classes(&css) {
        if !declared.contains(name) && !classes.iter().any(|class| class == name) {
            classes.push(name.to_owned());
        }
    }
    classes
}

fn is_compound_boundary(byte: u8) -> bool {
    byte.is_ascii_whitespace() || matches!(byte, b',' | b'{' | b'}' | b'>' | b'+' | b'~' | b';')
}

// Only classes in the same compound selector as `&` (`&.active`,
// `&:not(.active)`) are modifiers, classes of ancestors like `.dark &` are not
fn ampersand_compound_classes(css: &str) -> Vec<&str> {
    let bytes = css.as_bytes();
    let mut names = Vec::new();
    let mut compound_end = 0usize;
    for (ampersand, _) in css.match_indices('&') {
        if ampersand < compound_end {
            continue;
        }
        let start = bytes[..ampersand]
            .iter()
            .rposition(|byte| is_compound_boundary(*byte))
            .map_or(0, |index| index + 1);
        compound_end = bytes[ampersand..]
            .iter()
            .position(|byte| is_compound_boundary(*byte))
            .map_or(bytes.len(), |index| ampersand + index);
        let compound = &css[start..compound_end];
        for (dot, _) in compound.match_indices('.') {
            let name_start = dot + 1;
            let name_end = compound[name_start..]
                .find(|character: char| {
                    character.is_ascii()
                        && !character.is_ascii_alphanumeric()
                        && character != '_'
                        && character != '-'
                })
                .map_or(compound.len(), |index| name_start + index);
            let name = &compound[name_start..name_end];
            if name.chars().next().is_some_and(|first| {
                !first.is_ascii() || first.is_ascii_alphabetic() || first == '_' || first == '-'
            }) {
                names.push(name);
            }
        }
    }
    names
}

pub(super) fn strip_css_comments(css: &str) -> String {
    let mut output = String::with_capacity(css.len());
    let mut rest = css;
    while let Some(start) = rest.find("/*") {
        output.push_str(&rest[..start]);
        let Some(relative_end) = rest[start + 2..].find("*/") else {
            return output;
        };
        rest = &rest[start + relative_end + 4..];
    }
    output.push_str(rest);
    output
}

pub(super) fn replace_class_selector(css: &str, original: &str, replacement: &str) -> String {
    let needle = format!(".{original}");
    let mut output = String::with_capacity(css.len());
    let mut rest = css;
    while let Some(index) = rest.find(&needle) {
        let end = index + needle.len();
        let next_is_word = rest[end..]
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_alphanumeric() || character == '_');
        if next_is_word {
            output.push_str(&rest[..end]);
        } else {
            output.push_str(&rest[..index]);
            output.push('.');
            output.push_str(replacement);
        }
        rest = &rest[end..];
    }
    output.push_str(rest);
    output
}

const ATTRS_JSX_ERROR: &str = "styled.*.attrs() values cannot contain JSX, pass the element as a prop where the component is rendered";
const ATTRS_TEMPLATE_ERROR: &str = "styled.*.attrs() values cannot contain vindur templates, define the template in a module level constant and reference it";
const ATTRS_STABLE_ID_ERROR: &str = "styled.*.attrs() values cannot call stableId(), define the id in a module level constant and reference it";

fn first_unsupported_attrs_value(
    object: &ObjectExpression<'_>,
    imports: &VindurImports<'_>,
) -> Option<(Span, &'static str)> {
    let mut visitor = UnsupportedAttrsValueFinder {
        imports,
        found: None,
    };
    visitor.visit_object_expression(object);
    visitor.found
}

struct UnsupportedAttrsValueFinder<'i> {
    imports: &'i VindurImports<'i>,
    found: Option<(Span, &'static str)>,
}

impl<'a> Visit<'a> for UnsupportedAttrsValueFinder<'_> {
    fn visit_jsx_element(&mut self, element: &JSXElement<'a>) {
        self.found.get_or_insert((element.span, ATTRS_JSX_ERROR));
    }

    fn visit_jsx_fragment(&mut self, fragment: &JSXFragment<'a>) {
        self.found.get_or_insert((fragment.span, ATTRS_JSX_ERROR));
    }

    fn visit_tagged_template_expression(&mut self, tagged: &TaggedTemplateExpression<'a>) {
        if is_vindur_template_tag(&tagged.tag, self.imports) {
            self.found
                .get_or_insert((tagged.span, ATTRS_TEMPLATE_ERROR));
        } else {
            walk::walk_tagged_template_expression(self, tagged);
        }
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if let Expression::Identifier(callee) = &call.callee
            && self.imports.get_identifier(callee) == Some("stableId")
        {
            self.found.get_or_insert((call.span, ATTRS_STABLE_ID_ERROR));
        } else {
            walk::walk_call_expression(self, call);
        }
    }
}
