use oxc_ast::ast::{
    Program, PropertyKey, Statement, TSLiteral, TSPropertySignature, TSSignature, TSType,
    TSTypeName,
};
use oxc_span::GetSpan;
use rustc_hash::FxHashSet;

use crate::{CompilerDiagnostic, hash::murmur2};

use super::styled::{
    StyleFlag, StyleFlagKind, css_class_name_part, rewrite_class_chains, style_flag_classes,
};

pub(super) fn extract_style_flags(
    params: &[TSType<'_>],
    file_hash: &str,
    dev: bool,
    component_class: &str,
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
                return Err(CompilerDiagnostic::error(
                    file_path,
                    source,
                    reference.span,
                    format!(
                        "Type \"{type_name}\" not found. Only locally defined types are supported for style flags"
                    ),
                )
                .ignored_in_lint());
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
    let properties = type_literal
        .members
        .iter()
        .filter_map(|member| match member {
            TSSignature::TSPropertySignature(property) => Some(property.as_ref()),
            _ => None,
        })
        .collect::<Vec<_>>();
    colliding_class_name_error(&properties, file_path, source)?;
    properties
        .into_iter()
        .map(|property| {
            style_flag_from_property(
                property,
                file_hash,
                dev,
                component_class,
                program,
                file_path,
                source,
            )
        })
        .collect()
}

/// `$` becomes `_` in class names, so `$active` and `_active` would share a class
fn colliding_class_name_error(
    properties: &[&TSPropertySignature<'_>],
    file_path: &str,
    source: &str,
) -> Result<(), CompilerDiagnostic> {
    let names = properties
        .iter()
        .filter_map(|property| match &property.key {
            PropertyKey::StaticIdentifier(key) => Some((key.name.as_str(), property.span)),
            _ => None,
        })
        .collect::<Vec<_>>();
    for (index, (name, span)) in names.iter().enumerate() {
        let class_name = css_class_name_part(name);
        if let Some((other, _)) = names[..index]
            .iter()
            .find(|(other, _)| other != name && css_class_name_part(other) == class_name)
        {
            return Err(CompilerDiagnostic::error(
                file_path,
                source,
                *span,
                format!(
                    "Style flags \"{other}\" and \"{name}\" would use the same class name \"{class_name}\", rename one of them"
                ),
            ));
        }
    }
    Ok(())
}

fn find_type_alias<'a>(program: &'a Program<'a>, name: &str) -> Option<&'a TSType<'a>> {
    program.body.iter().find_map(|statement| {
        let Statement::TSTypeAliasDeclaration(alias) = statement else {
            return None;
        };
        (alias.id.name.as_str() == name).then_some(&alias.type_annotation)
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
    file_hash: &str,
    dev: bool,
    component_class: &str,
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
                return Err(CompilerDiagnostic::error(
                    file_path,
                    source,
                    property.span,
                    format!(
                        "Type \"{type_name}\" not found. Only locally defined types are supported for style flags"
                    ),
                ));
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
    // Dev names start with the component class, e.g. `v1560qbr-1-Button-active`
    let hashed_class_name = if dev {
        format!("{component_class}-{}", css_class_name_part(&prop_name))
    } else {
        format!("v{}", murmur2(&format!("{file_hash}-{prop_name}")))
    };
    Ok(StyleFlag {
        hashed_class_name,
        kind,
        prop_name,
    })
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

/// Flags chained to another component's reference, like `${Parent}.active`, are that component's
/// flags, they are rewritten with its classes once every component is known
pub(crate) fn rewrite_style_flag_selectors(
    css: &str,
    flags: &[StyleFlag],
    reference_classes: &FxHashSet<&str>,
) -> String {
    let classes = style_flag_classes(flags);
    rewrite_class_chains(css, reference_classes, |reference, class| match reference {
        Some(_) => None,
        None => classes.get(class).map(String::as_str),
    })
}
