use oxc_ast::ast::{Argument, Expression, Program, Statement, TSTypeParameterInstantiation};
use rustc_hash::FxHashMap;

use crate::CompilerDiagnostic;

use super::style_flags::extract_style_flags;

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
    pub imports: &'a FxHashMap<String, String>,
    pub program: &'a Program<'a>,
    pub source: &'a str,
}

pub(crate) fn styled_tag_element(
    tag: &Expression<'_>,
    imports: &FxHashMap<String, String>,
) -> Option<String> {
    let Expression::StaticMemberExpression(member) = tag else {
        return None;
    };
    let Expression::Identifier(object) = &member.object else {
        return None;
    };
    if object.name.as_str() != "styled"
        && imports.get(object.name.as_str()).map(String::as_str) != Some("styled")
    {
        return None;
    }
    Some(member.property.name.to_string())
}

pub(crate) fn styled_tag_component(
    tag: &Expression<'_>,
    imports: &FxHashMap<String, String>,
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
    if callee.name.as_str() != "styled"
        && imports.get(callee.name.as_str()).map(String::as_str) != Some("styled")
    {
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
        && (callee.name.as_str() == "styled"
            || context
                .imports
                .get(callee.name.as_str())
                .map(String::as_str)
                == Some("styled"))
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
    Ok(component.map(|component| StyledDefinition {
        attrs: None,
        base_component: component,
        style_flags,
    }))
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
            let placeholder = format!("__VINDUR_STYLED_REF_{name}__");
            *rule = rule.replace(&placeholder, &format!(".{class_name}"));
            for flag in &component.style_flags {
                match &flag.kind {
                    StyleFlagKind::Boolean => {
                        *rule = rule.replace(
                            &format!(".{class_name}.{}", flag.prop_name),
                            &format!(".{class_name}.{}", flag.hashed_class_name),
                        );
                    }
                    StyleFlagKind::StringUnion(values) => {
                        for value in values {
                            *rule = rule.replace(
                                &format!(".{class_name}.{}-{value}", flag.prop_name),
                                &format!(".{class_name}.{}-{value}", flag.hashed_class_name),
                            );
                        }
                    }
                }
            }
        }
    }
    css_rules.iter().find_map(|rule| {
        let (_, suffix) = rule.split_once("__VINDUR_STYLED_REF_")?;
        let (name, _) = suffix.split_once("__")?;
        Some(name.to_owned())
    })
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
        .flat_map(|flag| match &flag.kind {
            StyleFlagKind::Boolean => vec![flag.prop_name.clone()],
            StyleFlagKind::StringUnion(values) => values
                .iter()
                .map(|value| format!("{}-{value}", flag.prop_name))
                .collect(),
        })
        .collect::<rustc_hash::FxHashSet<_>>();
    let bytes = css.as_bytes();
    let mut classes = Vec::new();
    let mut index = 0usize;
    while index + 2 <= bytes.len() {
        let starts_selector =
            bytes.get(index) == Some(&b'&') && bytes.get(index + 1) == Some(&b'.');
        let chained_selector = bytes.get(index) == Some(&b'.')
            && index > 0
            && bytes[index - 1] != b' '
            && bytes[index - 1] != b'\n';
        if !starts_selector && !chained_selector {
            index += 1;
            continue;
        }
        let start = if starts_selector {
            index + 2
        } else {
            index + 1
        };
        let Some(first) = bytes.get(start).copied() else {
            break;
        };
        if !first.is_ascii_alphabetic() && first != b'_' && first != b'-' {
            index = start + 1;
            continue;
        }
        let mut end = start + 1;
        while bytes
            .get(end)
            .is_some_and(|byte| byte.is_ascii_alphanumeric() || matches!(*byte, b'_' | b'-'))
        {
            end += 1;
        }
        let name = &css[start..end];
        if !declared.contains(name) && !classes.iter().any(|class| class == name) {
            classes.push(name.to_owned());
        }
        index = end;
    }
    classes
}

fn strip_css_comments(css: &str) -> String {
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

fn contains_class_selector(css: &str, name: &str) -> bool {
    let needle = format!(".{name}");
    css.match_indices(&needle).any(|(index, _)| {
        css[index + needle.len()..]
            .chars()
            .next()
            .is_none_or(|character| !character.is_ascii_alphanumeric() && character != '_')
    })
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
