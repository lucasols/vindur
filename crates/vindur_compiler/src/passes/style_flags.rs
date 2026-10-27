use oxc_ast::ast::{Program, PropertyKey, Statement, TSLiteral, TSSignature, TSType, TSTypeName};
use oxc_span::GetSpan;

use crate::{CompilerDiagnostic, hash::murmur2};

use super::{
    css_syntax::CssError,
    cx_modifier_selectors::{ModifierCss, rewrite_modifiers},
    styled::{StyleFlag, StyleFlagKind},
};

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
    file_hash: &str,
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
    type_literal
        .members
        .iter()
        .filter_map(|member| match member {
            TSSignature::TSPropertySignature(property) => Some(style_flag_from_property(
                property, file_hash, dev, program, file_path, source,
            )),
            _ => None,
        })
        .collect()
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
    property: &oxc_ast::ast::TSPropertySignature<'_>,
    file_hash: &str,
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
    let hash = murmur2(&format!("{file_hash}-{prop_name}"));
    let hashed_class_name = if dev {
        format!("v{hash}-{prop_name}")
    } else {
        format!("v{hash}")
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

/// Renames the flag classes of the element selectors, like `&.active`, classes of other elements,
/// like `& .active`, are kept as is
pub(crate) fn rewrite_style_flag_selectors(
    css: &str,
    flags: &[StyleFlag],
) -> Result<String, CssError> {
    let mappings = flags
        .iter()
        .flat_map(|flag| match &flag.kind {
            StyleFlagKind::Boolean => {
                vec![(flag.prop_name.clone(), flag.hashed_class_name.clone(), true)]
            }
            StyleFlagKind::StringUnion(values) => values
                .iter()
                .map(|value| {
                    (
                        format!("{}-{value}", flag.prop_name),
                        format!("{}-{value}", flag.hashed_class_name),
                        true,
                    )
                })
                .collect(),
        })
        .collect::<Vec<_>>();
    rewrite_modifiers(css, ModifierCss::Block, &mappings)
}
