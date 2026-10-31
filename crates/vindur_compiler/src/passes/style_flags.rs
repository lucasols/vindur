use oxc_ast::ast::{
    Declaration, Program, PropertyKey, Statement, TSLiteral, TSPropertySignature, TSSignature,
    TSType, TSTypeName,
};
use oxc_span::{GetSpan, Span};

use crate::{CompilerDiagnostic, hash::murmur2};

use super::styled::{StyleFlag, StyleFlagKind};

/// Props that would stop working as style flags, which are removed and turned into classes
const RESERVED_PROP_NAMES: [&str; 16] = [
    "className",
    "style",
    "css",
    "cx",
    "dynamicColor",
    "key",
    "ref",
    "children",
    "disabled",
    "hidden",
    "checked",
    "required",
    "readOnly",
    "selected",
    "multiple",
    "open",
];

pub(super) fn extract_style_flags(
    params: &[TSType<'_>],
    component_class: &str,
    dev: bool,
    program: &Program<'_>,
    file_path: &str,
    source: &str,
) -> Result<Vec<StyleFlag>, CompilerDiagnostic> {
    let Some(first_param) = params.first() else {
        return Ok(Vec::new());
    };
    let type_literal = match first_param {
        TSType::TSTypeLiteral(type_literal) => type_literal,
        TSType::TSTypeReference(reference) => {
            let Some(type_name) = simple_type_reference_name(reference) else {
                return Err(CompilerDiagnostic::error(
                    file_path,
                    source,
                    reference.span,
                    "Only simple type references are supported for style flags".to_owned(),
                ));
            };
            let Some(resolved) = find_type_alias(program, type_name) else {
                return Err(
                    interface_flags_error(program, type_name, reference.span, file_path, source)
                        .unwrap_or_else(|| {
                            CompilerDiagnostic::error(
                                file_path,
                                source,
                                reference.span,
                                format!(
                                    "Type \"{type_name}\" not found. Only locally defined types are supported for style flags"
                                ),
                            )
                            .ignored_in_lint()
                        }),
                );
            };
            let TSType::TSTypeLiteral(type_literal) = resolved else {
                return Err(CompilerDiagnostic::error(
                    file_path,
                    source,
                    reference.span,
                    format!(
                        "Type \"{type_name}\" must be a simple object type for style flags. Complex types like unions, intersections, or imported types are not supported"
                    ),
                ));
            };
            type_literal
        }
        unsupported => {
            return Err(CompilerDiagnostic::error(
                file_path,
                source,
                unsupported.span(),
                format!(
                    "Style flags only support simple object types like \"{{ prop: boolean }}\" or type references. Complex inline types like \"{}\" are not supported",
                    type_string(unsupported)
                ),
            ));
        }
    };
    type_literal
        .members
        .iter()
        .filter_map(|member| match member {
            TSSignature::TSPropertySignature(property) => Some(style_flag_from_property(
                property,
                component_class,
                dev,
                program,
                file_path,
                source,
            )),
            _ => None,
        })
        .collect()
}

/// A type alias declared at the top level, also with `export type`
fn find_type_alias<'a>(program: &'a Program<'a>, name: &str) -> Option<&'a TSType<'a>> {
    program.body.iter().find_map(|statement| {
        let alias = match statement {
            Statement::TSTypeAliasDeclaration(alias) => alias,
            Statement::ExportNamedDeclaration(export) => match &export.declaration {
                Some(Declaration::TSTypeAliasDeclaration(alias)) => alias,
                _ => return None,
            },
            _ => return None,
        };
        (alias.id.name.as_str() == name).then_some(&alias.type_annotation)
    })
}

/// Interfaces get their own error, as "not found" would be misleading for a local type
fn interface_flags_error(
    program: &Program<'_>,
    type_name: &str,
    span: Span,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    let is_interface = program.body.iter().any(|statement| {
        let interface = match statement {
            Statement::TSInterfaceDeclaration(interface) => interface,
            Statement::ExportNamedDeclaration(export) => match &export.declaration {
                Some(Declaration::TSInterfaceDeclaration(interface)) => interface,
                _ => return false,
            },
            _ => return false,
        };
        interface.id.name.as_str() == type_name
    });
    is_interface.then(|| {
        CompilerDiagnostic::error(
            file_path,
            source,
            span,
            format!(
                "Style flags must use a type alias, like \"type {type_name} = {{ active: boolean }}\", interfaces are not supported"
            ),
        )
    })
}

fn simple_type_reference_name<'r>(
    reference: &'r oxc_ast::ast::TSTypeReference<'_>,
) -> Option<&'r str> {
    let TSTypeName::IdentifierReference(name) = &reference.type_name else {
        return None;
    };
    Some(name.name.as_str())
}

fn style_flag_from_property(
    property: &TSPropertySignature<'_>,
    component_class: &str,
    dev: bool,
    program: &Program<'_>,
    file_path: &str,
    source: &str,
) -> Result<StyleFlag, CompilerDiagnostic> {
    let PropertyKey::StaticIdentifier(key) = &property.key else {
        return Err(CompilerDiagnostic::error(
            file_path,
            source,
            property.span,
            "Style flag properties must use identifier names".to_owned(),
        ));
    };
    if key.name.starts_with('$') {
        return Err(CompilerDiagnostic::error(
            file_path,
            source,
            key.span,
            format!(
                "Style flag `{}` can't start with `$`, style flags are never passed to the DOM, so use `{}`",
                key.name,
                key.name.trim_start_matches('$')
            ),
        ));
    }
    if key.name.contains('$') {
        return Err(CompilerDiagnostic::error(
            file_path,
            source,
            key.span,
            format!(
                "Style flag `{}` can't contain `$`, as it becomes part of a class name",
                key.name
            ),
        ));
    }
    if RESERVED_PROP_NAMES.contains(&key.name.as_str()) {
        return Err(CompilerDiagnostic::error(
            file_path,
            source,
            key.span,
            format!(
                "Style flag `{}` is a prop React, vindur or the element handles, style flags are turned into classes and never passed to the element, so use another name",
                key.name
            ),
        ));
    }
    // The runtime stores the flag props in an object, where `__proto__` sets its prototype
    if key.name == "__proto__" {
        return Err(CompilerDiagnostic::error(
            file_path,
            source,
            key.span,
            "Style flag `__proto__` is not supported, use another name".to_owned(),
        ));
    }
    let Some(annotation) = &property.type_annotation else {
        return Err(CompilerDiagnostic::error(
            file_path,
            source,
            property.span,
            "Style flag properties must have a type annotation".to_owned(),
        ));
    };
    let type_annotation = &annotation.type_annotation;
    let prop_name = key.name.to_string();
    let kind = match type_annotation {
        TSType::TSBooleanKeyword(_) => StyleFlagKind::Boolean,
        TSType::TSUnionType(union) => {
            invalid_union_value_error(&union.types, &prop_name, file_path, source)?;
            let Some(values) = string_union_values(&union.types) else {
                return Err(CompilerDiagnostic::error(
                    file_path,
                    source,
                    property.span,
                    format!(
                        "Style flags only support boolean properties and string literal unions. Property \"{prop_name}\" has type \"{}\".",
                        type_string(type_annotation)
                    ),
                ));
            };
            StyleFlagKind::StringUnion(values)
        }
        TSType::TSTypeReference(reference) => {
            let Some(type_name) = simple_type_reference_name(reference) else {
                return Err(CompilerDiagnostic::error(
                    file_path,
                    source,
                    property.span,
                    "Only simple type references are supported for style flags".to_owned(),
                ));
            };
            let Some(resolved) = find_type_alias(program, type_name) else {
                return Err(
                    interface_flags_error(program, type_name, property.span, file_path, source)
                        .unwrap_or_else(|| {
                            CompilerDiagnostic::error(
                                file_path,
                                source,
                                property.span,
                                format!(
                                    "Type \"{type_name}\" not found. Only locally defined types are supported for style flags"
                                ),
                            )
                        }),
                );
            };
            match resolved {
                TSType::TSBooleanKeyword(_) => StyleFlagKind::Boolean,
                TSType::TSUnionType(union) => {
                    invalid_union_value_error(&union.types, &prop_name, file_path, source)?;
                    let Some(values) = string_union_values(&union.types) else {
                        return Err(CompilerDiagnostic::error(
                            file_path,
                            source,
                            property.span,
                            format!(
                                "Referenced type must be a string literal union. Property \"{prop_name}\" references type \"{}\" which is not supported",
                                type_string(resolved)
                            ),
                        ));
                    };
                    StyleFlagKind::StringUnion(values)
                }
                unsupported => {
                    return Err(CompilerDiagnostic::error(
                        file_path,
                        source,
                        property.span,
                        format!(
                            "Referenced type must be a boolean or string literal union. Property \"{prop_name}\" references type \"{}\" which is not supported",
                            type_string(unsupported)
                        ),
                    ));
                }
            }
        }
        unsupported => {
            return Err(CompilerDiagnostic::error(
                file_path,
                source,
                property.span,
                format!(
                    "Style flags only support boolean properties and string literal unions. Property \"{prop_name}\" has type \"{}\".",
                    type_string(unsupported)
                ),
            ));
        }
    };
    // Modifier classes are scoped to the component, dev names read like `v1560qbr-1-Button-active`
    let hashed_class_name = if dev {
        format!("{component_class}-{prop_name}")
    } else {
        format!("v{}", murmur2(&format!("{component_class}-{prop_name}")))
    };
    Ok(StyleFlag {
        hashed_class_name,
        kind,
        prop_name,
        span: property.span,
    })
}

/// The flags of an extended component: the base flags still apply, and a flag redeclared from
/// the base keeps its modifier class, so the base modifier styles still match
pub(super) fn with_base_style_flags(
    base_flags: &[StyleFlag],
    own_flags: &[StyleFlag],
    file_path: &str,
    source: &str,
) -> Result<Vec<StyleFlag>, CompilerDiagnostic> {
    let mut flags = base_flags
        .iter()
        .filter(|flag| !own_flags.iter().any(|own| own.prop_name == flag.prop_name))
        .cloned()
        .collect::<Vec<_>>();
    for own in own_flags {
        let Some(base) = base_flags
            .iter()
            .find(|base| base.prop_name == own.prop_name)
        else {
            flags.push(own.clone());
            continue;
        };
        if let (StyleFlagKind::Boolean, StyleFlagKind::StringUnion(_))
        | (StyleFlagKind::StringUnion(_), StyleFlagKind::Boolean) = (&base.kind, &own.kind)
        {
            let base_kind = match base.kind {
                StyleFlagKind::Boolean => "a boolean",
                StyleFlagKind::StringUnion(_) => "a string union",
            };
            return Err(CompilerDiagnostic::error(
                file_path,
                source,
                own.span,
                format!(
                    "Style flag \"{}\" is {base_kind} in the extended component, redeclare it with the same type",
                    own.prop_name
                ),
            ));
        }
        flags.push(StyleFlag {
            hashed_class_name: base.hashed_class_name.clone(),
            ..own.clone()
        });
    }
    Ok(flags)
}

/// The own flags of an extended component that its base doesn't style: new flags, and the new
/// values of a redeclared string union
pub(super) fn flags_without_base_styles(
    base_flags: &[StyleFlag],
    own_flags: &[StyleFlag],
) -> Vec<StyleFlag> {
    own_flags
        .iter()
        .filter_map(|own| {
            let Some(base) = base_flags
                .iter()
                .find(|base| base.prop_name == own.prop_name)
            else {
                return Some(own.clone());
            };
            let (StyleFlagKind::StringUnion(own_values), StyleFlagKind::StringUnion(base_values)) =
                (&own.kind, &base.kind)
            else {
                return None;
            };
            let new_values = own_values
                .iter()
                .filter(|value| !base_values.contains(value))
                .cloned()
                .collect::<Vec<_>>();
            (!new_values.is_empty()).then(|| StyleFlag {
                kind: StyleFlagKind::StringUnion(new_values),
                ..own.clone()
            })
        })
        .collect()
}

fn type_string(type_node: &TSType<'_>) -> String {
    match type_node {
        TSType::TSBooleanKeyword(_) => "boolean".to_owned(),
        TSType::TSStringKeyword(_) => "string".to_owned(),
        TSType::TSNumberKeyword(_) => "number".to_owned(),
        TSType::TSUnionType(union) => union
            .types
            .iter()
            .map(type_string)
            .collect::<Vec<_>>()
            .join(" | "),
        TSType::TSIntersectionType(intersection) => intersection
            .types
            .iter()
            .map(type_string)
            .collect::<Vec<_>>()
            .join(" & "),
        TSType::TSLiteralType(literal) => match &literal.literal {
            TSLiteral::StringLiteral(value) => format!("\"{}\"", value.value),
            TSLiteral::NumericLiteral(value) => value.value.to_string(),
            TSLiteral::BooleanLiteral(value) => value.value.to_string(),
            _ => "unknown".to_owned(),
        },
        TSType::TSTypeLiteral(_) => "{ ... }".to_owned(),
        TSType::TSTypeReference(reference) => simple_type_reference_name(reference)
            .unwrap_or("TypeReference")
            .to_owned(),
        TSType::TSArrayType(array) => format!("{}[]", type_string(&array.element_type)),
        _ => "unknown".to_owned(),
    }
}

// Union values become class names like `size-small` in the CSS and the generated code, so
// they must be plain class name characters
fn invalid_union_value_error(
    types: &[TSType<'_>],
    prop_name: &str,
    file_path: &str,
    source: &str,
) -> Result<(), CompilerDiagnostic> {
    let invalid = types.iter().find_map(|union_type| {
        let TSType::TSLiteralType(literal_type) = union_type else {
            return None;
        };
        let TSLiteral::StringLiteral(literal) = &literal_type.literal else {
            return None;
        };
        let value = literal.value.as_str();
        let is_valid = !value.is_empty()
            && value.chars().all(|character| {
                character.is_ascii_alphanumeric() || character == '_' || character == '-'
            });
        (!is_valid).then_some(literal)
    });
    match invalid {
        Some(literal) => Err(CompilerDiagnostic::error(
            file_path,
            source,
            literal.span,
            format!(
                "Style flag \"{prop_name}\" value \"{}\" must only contain letters, digits, - and _, as it becomes part of a class name",
                literal.value
            ),
        )),
        None => Ok(()),
    }
}

fn string_union_values(types: &[TSType<'_>]) -> Option<Vec<String>> {
    let mut values = Vec::with_capacity(types.len());
    for union_type in types {
        let TSType::TSLiteralType(literal_type) = union_type else {
            return None;
        };
        let TSLiteral::StringLiteral(literal) = &literal_type.literal else {
            return None;
        };
        values.push(literal.value.to_string());
    }
    (!values.is_empty()).then_some(values)
}
