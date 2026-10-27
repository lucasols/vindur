use oxc_ast::ast::{
    Argument, CallExpression, Expression, JSXElement, JSXFragment, ObjectExpression, Program,
    Statement, TSTypeParameterInstantiation, TaggedTemplateExpression,
};
use oxc_ast_visit::{Visit, walk};
use oxc_span::{GetSpan, Span};
use rustc_hash::FxHashMap;

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
    if let Expression::CallExpression(call) = attrs_base(tag)
        && let [Argument::CallExpression(_)] = call.arguments.as_slice()
    {
        return "styled() cannot extend a call expression, assign it to a const first, e.g. `const Base = wrap(Component)` and then `styled(Base)`";
    }
    "Unsupported styled component definition, use styled.tag`...`, styled(Component)`...` or add a single .attrs({...}) to them"
}

/// The `styled(...)` call an `.attrs({...})` call is made on, or the tag itself
fn attrs_base<'b, 'a>(tag: &'b Expression<'a>) -> &'b Expression<'a> {
    if let Expression::CallExpression(call) = tag
        && let Expression::StaticMemberExpression(member) = &call.callee
        && member.property.name.as_str() == "attrs"
    {
        return &member.object;
    }
    tag
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
                            | Expression::CallExpression(_)
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
            *rule = rule.replace(&styled_ref_placeholder(name), &format!(".{class_name}"));
        }
    }
    css_rules.iter().find_map(|rule| {
        let (_, suffix) = rule.split_once(STYLED_REF_PREFIX)?;
        let (encoded, _) = suffix.split_once(STYLED_REF_SUFFIX)?;
        hex_decode(encoded)
    })
}

const STYLED_REF_PREFIX: &str = "__VINDUR_STYLED_REF_";
const STYLED_REF_SUFFIX: &str = "__";

/// Forward styled component references are replaced by a placeholder until every component is
/// known, the name is hex encoded because JS identifiers can contain `$`, which CSS rejects
pub(crate) fn styled_ref_placeholder(name: &str) -> String {
    format!("{STYLED_REF_PREFIX}{}{STYLED_REF_SUFFIX}", hex_encode(name))
}

pub(crate) fn is_styled_ref_placeholder(text: &str) -> bool {
    text.starts_with(STYLED_REF_PREFIX)
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
