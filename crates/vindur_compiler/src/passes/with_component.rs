use oxc_ast::ast::{Argument, Expression, VariableDeclaration};
use oxc_span::GetSpan;

use crate::{
    CompilerDiagnostic,
    edit::{Edit, expand_removal_to_line},
    facts::StaticValue,
};

use super::style_flag_selectors::flag_classes;
use super::styled::{StyleFlag, StyledComponent};
use super::transform_support::{VariableTransform, require_const};

pub(super) fn process_with_component(
    initializer: &Expression<'_>,
    declaration: &VariableDeclaration<'_>,
    variable_name: &str,
    transform: &mut VariableTransform<'_>,
) -> Result<bool, CompilerDiagnostic> {
    let initializer = initializer.without_parentheses();
    let Expression::CallExpression(call) = initializer else {
        return Ok(false);
    };
    let Expression::StaticMemberExpression(member) = &call.callee else {
        return Ok(false);
    };
    if member.property.name.as_str() != "withComponent" {
        return Ok(false);
    }
    let Expression::Identifier(base_identifier) = &member.object else {
        return Ok(false);
    };
    let Some(base) = transform
        .styled_components
        .get(base_identifier.name.as_str())
        .cloned()
    else {
        return Err(CompilerDiagnostic::error(
            transform.file_path,
            transform.source,
            base_identifier.span,
            format!(
                "Cannot call withComponent on \"{}\": it is not a styled component.",
                base_identifier.name
            ),
        ));
    };
    // The styles of an imported styled base are applied by it, replacing it drops them
    if base.element_is_base
        && !transform.styled_components.contains_key(&base.element)
        && matches!(
            transform.constants.get(&base.element),
            Some(StaticValue::ClassName { .. })
        )
    {
        return Err(CompilerDiagnostic::error(
            transform.file_path,
            transform.source,
            base_identifier.span,
            format!(
                "Cannot call withComponent on \"{}\": it extends the imported styled component \"{}\", whose styles would be lost on the new element. Call withComponent on \"{}\" in its own file and extend that instead.",
                base_identifier.name, base.element, base.element
            ),
        ));
    }
    require_const(declaration, transform.file_path, transform.source)?;
    let (element, element_is_identifier, argument_span) = match call.arguments.as_slice() {
        [Argument::StringLiteral(element)] => (element.value.to_string(), false, element.span),
        [Argument::Identifier(element)] => (element.name.to_string(), true, element.span),
        [argument] => (String::new(), false, argument.span()),
        _ => (String::new(), false, call.span),
    };
    if declaration.declarations.len() != 1 {
        return Err(CompilerDiagnostic::error(
            transform.file_path,
            transform.source,
            declaration.span,
            "withComponent() must use its own variable declaration".to_owned(),
        ));
    }
    if element.is_empty() {
        return Err(CompilerDiagnostic::error(
            transform.file_path,
            transform.source,
            argument_span,
            "withComponent() must be called with either a string literal element name or a component identifier."
                .to_owned(),
        ));
    }
    if element_is_identifier
        && let Some(message) =
            shared_flag_error(&base, base_identifier.name.as_str(), &element, transform)
    {
        return Err(CompilerDiagnostic::error(
            transform.file_path,
            transform.source,
            argument_span,
            message,
        ));
    }
    let runtime = transform.is_exported
        || transform.value_referenced_names.contains(variable_name)
        || base.runtime;
    let component = StyledComponent {
        attrs: base.attrs.clone(),
        class_name: base.class_name.clone(),
        element: element.clone(),
        element_is_identifier,
        element_is_base: false,
        runtime,
        style_flags: base.style_flags.clone(),
    };
    // References select the component's own class, the class names of the components it extends
    // are only applied to the element
    let reference_class = base
        .class_name
        .split_whitespace()
        .last()
        .unwrap_or_default();
    // A styled component element applies its own flag classes, which references select too
    let mut style_flags = flag_classes(&base.style_flags);
    if element_is_identifier
        && let Some(StaticValue::ClassName {
            style_flags: element_flags,
            ..
        }) = transform.constants.get(&element)
    {
        style_flags.extend(element_flags.iter().cloned());
    }
    transform.constants.insert(
        variable_name.to_owned(),
        StaticValue::ClassName {
            name: reference_class.to_owned(),
            style_flags,
        },
    );
    transform
        .styled_components
        .insert(variable_name.to_owned(), component);
    if runtime {
        let replacement = if base.style_flags.is_empty() {
            *transform.needs_styled_helper = true;
            let element_source = runtime_element_source(&element, element_is_identifier);
            let attrs = base
                .attrs
                .as_ref()
                .map_or(String::new(), |value| format!(", {value}"));
            format!("_vSC({element_source}, \"{}\"{attrs})", base.class_name)
        } else {
            *transform.needs_style_flags_helper = true;
            style_flags_runtime_call(
                &base.style_flags,
                &base.class_name,
                &element,
                element_is_identifier,
                base.attrs.as_deref(),
            )
        };
        transform.edits.push(Edit {
            span: initializer.span(),
            replacement,
        });
    } else {
        transform.edits.push(Edit {
            span: expand_removal_to_line(transform.source, declaration.span),
            replacement: String::new(),
        });
    }
    Ok(true)
}

/// The flags of `base` are never passed to the element, so a styled component element with a flag
/// of the same prop would never get it
fn shared_flag_error(
    base: &StyledComponent,
    base_name: &str,
    element: &str,
    transform: &VariableTransform<'_>,
) -> Option<String> {
    // Every styled component's flag classes, with the ones it inherits from an imported base
    let Some(StaticValue::ClassName {
        style_flags: element_classes,
        ..
    }) = transform.constants.get(element)
    else {
        return None;
    };
    let flag = base.style_flags.iter().find(|flag| {
        element_classes.iter().any(|class| {
            class
                .original
                .strip_prefix(flag.prop_name.as_str())
                .is_some_and(|rest| rest.is_empty() || rest.starts_with('-'))
        })
    })?;
    Some(format!(
        "Style flag `{}` of `{base_name}` is also a style flag of `{element}`, which would no longer get the prop, rename one of them",
        flag.prop_name
    ))
}

pub(super) fn style_flags_runtime_call(
    flags: &[StyleFlag],
    class_name: &str,
    element: &str,
    element_is_identifier: bool,
    attrs: Option<&str>,
) -> String {
    let modifier_array = flags
        .iter()
        .map(|flag| format!("[\"{}\", \"{}\"]", flag.prop_name, flag.hashed_class_name))
        .collect::<Vec<_>>()
        .join(", ");
    let element_source = runtime_element_source(element, element_is_identifier);
    let attrs_argument = attrs.map_or(String::new(), |value| format!(", {value}"));
    format!("_vCWM([{modifier_array}], \"{class_name}\", {element_source}{attrs_argument})")
}

/// Components are passed to the runtime helpers as references, DOM elements as tag names
pub(super) fn runtime_element_source(element: &str, element_is_identifier: bool) -> String {
    if element_is_identifier {
        element.to_owned()
    } else {
        format!("\"{element}\"")
    }
}
