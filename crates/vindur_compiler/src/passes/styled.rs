use oxc_ast::ast::{
    Argument, CallExpression, Expression, JSXAttribute, JSXAttributeName, JSXElement, JSXFragment,
    ObjectExpression, Program, Statement, TSTypeParameterInstantiation, TaggedTemplateExpression,
    TemplateLiteral,
};
use oxc_ast_visit::{Visit, walk};
use oxc_span::{GetSpan, Span};
use rustc_hash::FxHashMap;

use crate::{CompilerDiagnostic, semantic::VindurImports};

use super::css::{hex_decode, hex_encode};
use super::css_tokens::{is_ident_char, skipped_token_end};
use super::static_value::forward_styled_reference;
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
}

impl StyleFlag {
    /// The classes the flag selects in CSS, e.g. `active` or `size-small` and `size-large`
    pub(crate) fn class_names(&self) -> Vec<String> {
        match &self.kind {
            StyleFlagKind::Boolean => vec![self.prop_name.clone()],
            StyleFlagKind::StringUnion(values) => values
                .iter()
                .map(|value| format!("{}-{value}", self.prop_name))
                .collect(),
        }
    }
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
    pub components: &'a FxHashMap<String, StyledComponent>,
    pub dev: bool,
    pub file_hash: &'a str,
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
            context.file_hash,
            context.dev,
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
    for rule in css_rules.iter_mut() {
        for (name, component) in components {
            let Some(class_name) = component.class_name.split_whitespace().last() else {
                continue;
            };
            let placeholder = styled_ref_placeholder(name);
            if rule.contains(&placeholder) {
                *rule = rule.replace(&placeholder, &format!(".{class_name}"));
            }
            if let Some(replaced) =
                replace_reference_flag_classes(rule, class_name, &component.style_flags)
            {
                *rule = replaced;
            }
        }
    }
    css_rules.iter().find_map(|rule| {
        let (_, suffix) = rule.split_once(STYLED_REF_PREFIX)?;
        let (encoded, _) = suffix.split_once(STYLED_REF_SUFFIX)?;
        hex_decode(encoded)
    })
}

/// Renames the style flag classes in the compound selectors of a referenced component, like
/// `.Button.active.size-large`, `None` when there are none
fn replace_reference_flag_classes(
    css: &str,
    class_name: &str,
    flags: &[StyleFlag],
) -> Option<String> {
    if flags.is_empty() {
        return None;
    }
    let mut output = String::with_capacity(css.len());
    let mut copied = 0;
    for start in class_selector_starts(css, class_name) {
        let mut index = start + 1 + class_name.len();
        while css[index..].starts_with('.') {
            let name_start = index + 1;
            let name_end = css[name_start..]
                .find(|character: char| !is_ident_char(character))
                .map_or(css.len(), |end| name_start + end);
            if let Some(hashed) = hashed_flag_class(flags, &css[name_start..name_end]) {
                output.push_str(&css[copied..name_start]);
                output.push_str(&hashed);
                copied = name_end;
            }
            index = name_end;
        }
    }
    if copied == 0 {
        return None;
    }
    output.push_str(&css[copied..]);
    Some(output)
}

fn hashed_flag_class(flags: &[StyleFlag], class: &str) -> Option<String> {
    flags.iter().find_map(|flag| match &flag.kind {
        StyleFlagKind::Boolean => (flag.prop_name == class).then(|| flag.hashed_class_name.clone()),
        StyleFlagKind::StringUnion(values) => {
            let value = class
                .strip_prefix(flag.prop_name.as_str())?
                .strip_prefix('-')?;
            values
                .iter()
                .any(|candidate| candidate == value)
                .then(|| format!("{}-{value}", flag.hashed_class_name))
        }
    })
}

/// The `${() => name}` interpolation of a forward reference, used to locate errors about it.
/// References in vindur templates and css props come first, other templates can have the same
/// function
pub(crate) fn forward_reference_span(
    program: &Program<'_>,
    imports: &VindurImports<'_>,
    name: &str,
) -> Option<Span> {
    struct Finder<'n, 'i> {
        name: &'n str,
        imports: &'i VindurImports<'i>,
        in_vindur_template: bool,
        vindur_span: Option<Span>,
        span: Option<Span>,
    }
    impl<'a> Visit<'a> for Finder<'_, '_> {
        fn visit_tagged_template_expression(&mut self, tagged: &TaggedTemplateExpression<'a>) {
            let in_vindur_template = self.in_vindur_template;
            self.in_vindur_template = is_vindur_template_tag(&tagged.tag, self.imports);
            walk::walk_tagged_template_expression(self, tagged);
            self.in_vindur_template = in_vindur_template;
        }

        fn visit_jsx_attribute(&mut self, attribute: &JSXAttribute<'a>) {
            let in_vindur_template = self.in_vindur_template;
            self.in_vindur_template = matches!(
                &attribute.name,
                JSXAttributeName::Identifier(name) if name.name == "css"
            );
            walk::walk_jsx_attribute(self, attribute);
            self.in_vindur_template = in_vindur_template;
        }

        fn visit_template_literal(&mut self, template: &TemplateLiteral<'a>) {
            let span = template
                .expressions
                .iter()
                .find(|expression| forward_styled_reference(expression) == Some(self.name))
                .map(GetSpan::span);
            if self.in_vindur_template {
                self.vindur_span = self.vindur_span.or(span);
            }
            self.span = self.span.or(span);
            let in_vindur_template = self.in_vindur_template;
            self.in_vindur_template = false;
            walk::walk_template_literal(self, template);
            self.in_vindur_template = in_vindur_template;
        }
    }
    let mut finder = Finder {
        name,
        imports,
        in_vindur_template: false,
        vindur_span: None,
        span: None,
    };
    finder.visit_program(program);
    finder.vindur_span.or(finder.span)
}

const STYLED_REF_PREFIX: &str = "__VINDUR_STYLED_REF_";
const STYLED_REF_SUFFIX: &str = "__";

/// Forward styled component references are replaced by a placeholder until every component is
/// known, the name is hex encoded because JS identifiers can contain `$`, which CSS rejects
pub(crate) fn styled_ref_placeholder(name: &str) -> String {
    format!("{STYLED_REF_PREFIX}{}{STYLED_REF_SUFFIX}", hex_encode(name))
}

pub(crate) fn missing_style_flag_selectors(css: &str, flags: &[StyleFlag]) -> Vec<String> {
    let css = strip_css_comments(css);
    let mut missing = Vec::new();
    for flag in flags {
        match &flag.kind {
            StyleFlagKind::Boolean => {
                if !contains_class_selector(&css, &flag.prop_name)
                    && !contains_class_selector(&css, &flag.hashed_class_name)
                {
                    missing.push(format!("&.{}", flag.prop_name));
                }
            }
            StyleFlagKind::StringUnion(values) => {
                for value in values {
                    let original = format!("{}-{value}", flag.prop_name);
                    let hashed = format!("{}-{value}", flag.hashed_class_name);
                    if !contains_class_selector(&css, &original)
                        && !contains_class_selector(&css, &hashed)
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
        .flat_map(StyleFlag::class_names)
        .collect::<rustc_hash::FxHashSet<_>>();
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
                    !character.is_ascii_alphanumeric() && character != '_' && character != '-'
                })
                .map_or(compound.len(), |index| name_start + index);
            let name = &compound[name_start..name_end];
            if name
                .chars()
                .next()
                .is_some_and(|first| first.is_ascii_alphabetic() || first == '_' || first == '-')
            {
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

/// Whether a class name continues after `index`
fn continues_class_name(css: &str, index: usize) -> bool {
    css[index..].chars().next().is_some_and(is_ident_char)
}

fn contains_class_selector(css: &str, name: &str) -> bool {
    !class_selector_starts(css, name).is_empty()
}

/// `None` when the CSS doesn't select the class
pub(super) fn replace_class_selector(
    css: &str,
    original: &str,
    replacement: &str,
) -> Option<String> {
    let starts = class_selector_starts(css, original);
    if starts.is_empty() {
        return None;
    }
    let needle_len = original.len() + 1;
    let mut output = String::with_capacity(css.len());
    let mut copied = 0;
    for start in starts {
        output.push_str(&css[copied..start]);
        output.push('.');
        output.push_str(replacement);
        copied = start + needle_len;
    }
    output.push_str(&css[copied..]);
    Some(output)
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

/// Where `.name` selects the class, strings, urls and comments are skipped, so
/// `url("a.name.svg")` is left alone
fn class_selector_starts(css: &str, name: &str) -> Vec<usize> {
    let needle = format!(".{name}");
    let mut starts = Vec::new();
    if !css.contains(&needle) {
        return starts;
    }
    let mut index = 0;
    while index < css.len() {
        if let Some(end) = skipped_token_end(css, index) {
            index = end;
            continue;
        }
        if css[index..].starts_with(&needle) && !continues_class_name(css, index + needle.len()) {
            starts.push(index);
            index += needle.len();
            continue;
        }
        index += css[index..].chars().next().map_or(1, char::len_utf8);
    }
    starts
}
