use oxc_ast::ast::{Argument, Expression};
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use crate::{
    CompilerDiagnostic,
    edit::{Edit, expand_removal_to_line},
    facts::StaticValue,
};

use super::scoped::declared_scoped_variable_names;
use super::styled::{StyleFlag, StyledComponent};
use super::transform_support::VariableTransform;

pub(super) fn record_scoped_declarations(
    css: &str,
    span: oxc_span::Span,
    declarations: &mut FxHashMap<String, oxc_span::Span>,
) {
    for name in declared_scoped_variable_names(css) {
        declarations.entry(name).or_insert(span);
    }
}

pub(super) fn process_with_component(
    initializer: &Expression<'_>,
    declaration_span: oxc_span::Span,
    variable_name: &str,
    transform: &mut VariableTransform<'_>,
) -> Result<bool, CompilerDiagnostic> {
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
    let (element, element_is_identifier, argument_span) = match call.arguments.as_slice() {
        [Argument::StringLiteral(element)] => (element.value.to_string(), false, element.span),
        [Argument::Identifier(element)] => (element.name.to_string(), true, element.span),
        [argument] => (String::new(), false, argument.span()),
        _ => (String::new(), false, call.span),
    };
    if element.is_empty() {
        return Err(CompilerDiagnostic::error(
            transform.file_path,
            transform.source,
            argument_span,
            "withComponent() must be called with either a string literal element name or a component identifier."
                .to_owned(),
        ));
    }
    let runtime = transform.is_exported || base.runtime;
    let component = StyledComponent {
        attrs: base.attrs.clone(),
        class_name: base.class_name.clone(),
        element: element.clone(),
        element_is_identifier,
        runtime,
        style_flags: base.style_flags.clone(),
    };
    transform.constants.insert(
        variable_name.to_owned(),
        StaticValue::ClassName(base.class_name.clone()),
    );
    transform
        .styled_components
        .insert(variable_name.to_owned(), component);
    if runtime {
        let replacement = if base.style_flags.is_empty() {
            *transform.needs_styled_helper = true;
            let element_source = if element_is_identifier {
                element
            } else {
                format!("\"{element}\"")
            };
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
            span: expand_removal_to_line(transform.source, declaration_span),
            replacement: String::new(),
        });
    }
    Ok(true)
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
    let element_source = if element_is_identifier {
        element.to_owned()
    } else {
        format!("\"{element}\"")
    };
    let attrs_argument = attrs.map_or(String::new(), |value| format!(", {value}"));
    format!("_vCWM([{modifier_array}], \"{class_name}\", {element_source}{attrs_argument})")
}
