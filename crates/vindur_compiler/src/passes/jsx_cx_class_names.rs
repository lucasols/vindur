use oxc_ast::ast::{
    Argument, BindingPattern, Expression, IdentifierReference, JSXAttributeValue, JSXElement,
    JSXExpression, LogicalOperator, ObjectPropertyKind, Program, VariableDeclarator,
};
use std::borrow::Cow;

use oxc_ast_visit::{Visit, walk};
use oxc_semantic::Scoping;
use oxc_span::{GetSpan, Span};
use rustc_hash::FxHashMap;

use crate::{CompilerDiagnostic, facts::StaticValue, semantic::VindurImports};

use super::{
    cx_modifier_selectors::{ModifierCss, element_class_names},
    jsx_attributes::{find_attributes, jsx_name},
    jsx_cx_component_references::HashedStyledModifier,
    static_evaluation::resolved_constant,
    styled::StyledComponent,
    styled_jsx_helpers::decode_jsx_entities,
};

/// A cx key hashed in the rules of a local css reference, which are renamed in place for every
/// element using it
pub(crate) struct HashedCssReferenceKey {
    /// The class name of the css reference
    pub css_class: String,
    pub key: String,
    /// The element whose cx prop hashes it
    pub element_name: String,
}

/// Fails for a class written as a string in the `className` of an element whose `&.class` styles
/// a cx prop hashes, e.g. `<Box className="active" />` with `<Box cx={{ active }} />`,
/// `<div css={...} cx={{ active }} className="active" />` or
/// `<div className={cx(card, 'active')} />` with `<div className={card} cx={{ active }} />`. Also
/// checks the `className` of the styled component `.attrs()`
pub(crate) fn static_hashed_class_name_error(
    program: &Program<'_>,
    context: StaticClassNameContext<'_>,
) -> Option<CompilerDiagnostic> {
    if !context.has_hashed_keys {
        return None;
    }
    let mut visitor = StaticClassNameVisitor {
        context,
        diagnostic: None,
    };
    visitor.visit_program(program);
    visitor.diagnostic
}

pub(crate) struct StaticClassNameContext<'a> {
    pub imports: &'a VindurImports<'a>,
    pub styled_components: &'a FxHashMap<String, StyledComponent>,
    pub constants: &'a FxHashMap<String, StaticValue>,
    pub scoping: &'a Scoping,
    pub modifiers: &'a [HashedStyledModifier],
    pub css_reference_keys: &'a [HashedCssReferenceKey],
    pub has_hashed_keys: bool,
    pub file_path: &'a str,
    pub source: &'a str,
}

struct StaticClassNameVisitor<'a> {
    context: StaticClassNameContext<'a>,
    diagnostic: Option<CompilerDiagnostic>,
}

/// A hashed cx key and the element whose cx prop hashes it
struct HashedKey {
    name: String,
    owner: String,
}

/// Where the static classes are written, for the fix suggested in the error
#[derive(Clone, Copy)]
enum ClassSource {
    Element,
    Attrs,
}

/// A css reference used in a `className` or `css` expression
struct UsedCssReference<'c> {
    identifier: String,
    span: Span,
    class_name: &'c str,
    css: &'c str,
}

impl<'a> Visit<'a> for StaticClassNameVisitor<'_> {
    fn visit_jsx_element(&mut self, element: &JSXElement<'a>) {
        if self.diagnostic.is_some() {
            return;
        }
        self.check_element(element);
        walk::walk_jsx_element(self, element);
    }

    fn visit_variable_declarator(&mut self, declarator: &VariableDeclarator<'a>) {
        if self.diagnostic.is_some() {
            return;
        }
        self.check_attrs(declarator);
        walk::walk_variable_declarator(self, declarator);
    }
}

impl<'v> StaticClassNameVisitor<'v> {
    fn check_element(&mut self, element: &JSXElement<'_>) {
        let Some(name) = jsx_name(&element.opening_element.name) else {
            return;
        };
        let mut hashed = match self.context.styled_components.get(name) {
            Some(styled) => self.styled_hashed_keys(styled, false),
            None => Vec::new(),
        };
        hashed.extend(own_hashed_keys(element).map(|key| HashedKey {
            name: key,
            owner: name.to_owned(),
        }));
        let mut strings = Vec::new();
        let mut references = Vec::new();
        for attribute_name in ["className", "css"] {
            for attribute in find_attributes(element, attribute_name) {
                match &attribute.value {
                    Some(JSXAttributeValue::StringLiteral(literal))
                        if attribute_name == "className" =>
                    {
                        strings.push((decode_jsx_entities(&literal.value), literal.span));
                    }
                    Some(JSXAttributeValue::ExpressionContainer(container)) => {
                        if let Some(expression) = container.expression.as_expression() {
                            self.css_references(expression, &mut references);
                            if attribute_name == "className" {
                                self.class_strings(expression, false, &mut strings);
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        hashed.extend(self.css_reference_hashed_keys(&references));
        self.report(name, &hashed, &strings, ClassSource::Element);
    }

    /// The `className` of `styled.div.attrs({ className: '...' })`, which the styled components
    /// extending it get too
    fn check_attrs(&mut self, declarator: &VariableDeclarator<'_>) {
        let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
            return;
        };
        let name = identifier.name.as_str();
        let Some(styled) = self.context.styled_components.get(name) else {
            return;
        };
        let Some(Expression::TaggedTemplateExpression(tagged)) = &declarator.init else {
            return;
        };
        let Expression::CallExpression(call) = &tagged.tag else {
            return;
        };
        let Expression::StaticMemberExpression(member) = &call.callee else {
            return;
        };
        let [Argument::ObjectExpression(object)] = call.arguments.as_slice() else {
            return;
        };
        if member.property.name.as_str() != "attrs" {
            return;
        }
        let mut strings = Vec::new();
        let mut references = Vec::new();
        for property in &object.properties {
            if let ObjectPropertyKind::ObjectProperty(property) = property
                && property.key.static_name().as_deref() == Some("className")
            {
                self.class_strings(&property.value, false, &mut strings);
                self.css_references(&property.value, &mut references);
            }
        }
        let mut hashed = self.styled_hashed_keys(styled, true);
        // Modifiers of css references in `.attrs()` are not renamed for the styled component cx
        // props, like `className={styles}` on the element
        for reference in &references {
            let declared =
                element_class_names(reference.css, ModifierCss::Block).unwrap_or_default();
            if let Some(key) = hashed.iter().find(|key| declared.contains(&key.name)) {
                self.diagnostic = Some(CompilerDiagnostic::error(
                    self.context.file_path,
                    self.context.source,
                    reference.span,
                    format!(
                        "cx prop modifiers can't be used on styled component \"{owner}\" with the css reference \"{identifier}\" in its .attrs() className. Move the modifier styles into the styled component or use $-prefixed classes (e.g. ${key}).",
                        owner = key.owner,
                        identifier = reference.identifier,
                        key = key.name
                    ),
                ));
                return;
            }
        }
        hashed.extend(self.css_reference_hashed_keys(&references));
        self.report(name, &hashed, &strings, ClassSource::Attrs);
    }

    /// The hashed keys of the cx props of a styled component, also of the components it extends.
    /// With `extending`, also the keys of the components extending it, which get its `.attrs()`
    fn styled_hashed_keys(&self, styled: &StyledComponent, extending: bool) -> Vec<HashedKey> {
        let own_class = styled.class_name.split_whitespace().last();
        self.context
            .modifiers
            .iter()
            .filter(|modifier| {
                let is_own_or_base = modifier.classes.last().is_some_and(|owner| {
                    styled
                        .class_name
                        .split_whitespace()
                        .any(|class| class == owner)
                });
                let is_extending = extending
                    && own_class
                        .is_some_and(|own| modifier.classes.iter().any(|class| class == own));
                is_own_or_base || is_extending
            })
            .map(|modifier| HashedKey {
                name: modifier.class_name.clone(),
                owner: modifier.element_name.clone(),
            })
            .collect()
    }

    /// The hashed keys the used css references declare as modifiers
    fn css_reference_hashed_keys(&self, references: &[UsedCssReference<'_>]) -> Vec<HashedKey> {
        let mut hashed = Vec::new();
        for reference in references {
            let keys = self
                .context
                .css_reference_keys
                .iter()
                .filter(|key| key.css_class == reference.class_name)
                .collect::<Vec<_>>();
            if keys.is_empty() {
                continue;
            }
            let declared =
                element_class_names(reference.css, ModifierCss::Block).unwrap_or_default();
            hashed.extend(
                keys.into_iter()
                    .filter(|key| declared.contains(&key.key))
                    .map(|key| HashedKey {
                        name: key.key.clone(),
                        owner: key.element_name.clone(),
                    }),
            );
        }
        hashed
    }

    /// The css references anywhere in the expression
    fn css_references(
        &self,
        expression: &Expression<'_>,
        references: &mut Vec<UsedCssReference<'v>>,
    ) {
        let mut collector = CssReferenceCollector {
            constants: self.context.constants,
            scoping: self.context.scoping,
            references,
        };
        collector.visit_expression(expression);
    }

    fn report(
        &mut self,
        name: &str,
        hashed: &[HashedKey],
        strings: &[(String, Span)],
        source: ClassSource,
    ) {
        if hashed.is_empty() {
            return;
        }
        for (classes, span) in strings {
            for class in classes.split_ascii_whitespace() {
                let Some(key) = hashed.iter().find(|key| key.name == class) else {
                    continue;
                };
                let owner = &key.owner;
                let message = match source {
                    ClassSource::Element => format!(
                        "class \"{class}\" on \"{name}\" never matches its \"&.{class}\" styles, as the cx prop of \"{owner}\" hashes it. Use cx={{{{ {key}: true }}}} instead, or \"${class}\" in the cx prop to keep the class name",
                        key = property_key(class)
                    ),
                    ClassSource::Attrs => format!(
                        "class \"{class}\" in the .attrs() of \"{name}\" never matches the \"&.{class}\" styles of \"{owner}\", as its cx prop hashes it. Remove it from .attrs() and add it with the cx prop where it's needed, or \"${class}\" in the cx prop to keep the class name"
                    ),
                };
                self.diagnostic = Some(CompilerDiagnostic::error(
                    self.context.file_path,
                    self.context.source,
                    *span,
                    message,
                ));
                return;
            }
        }
    }

    /// The string literals of a className expression that become classes, e.g. both branches of a
    /// conditional or the arguments and object keys of a `cx()` call. `in_cx` is set for the
    /// arguments of a `cx()` call, where object keys are classes
    fn class_strings(
        &self,
        expression: &Expression<'_>,
        in_cx: bool,
        strings: &mut Vec<(String, Span)>,
    ) {
        match expression.get_inner_expression() {
            Expression::StringLiteral(literal) => {
                strings.push((literal.value.as_str().to_owned(), literal.span));
            }
            Expression::TemplateLiteral(template) => {
                let last = template.quasis.len().saturating_sub(1);
                for (index, quasi) in template.quasis.iter().enumerate() {
                    let Some(cooked) = &quasi.value.cooked else {
                        continue;
                    };
                    let text = cooked.as_str();
                    // Classes joined to an expression, like `item-` in `item-${id}`, are not
                    // known
                    let start = if index > 0 && !starts_with_separator(text) {
                        text.find(|c: char| c.is_ascii_whitespace())
                            .unwrap_or(text.len())
                    } else {
                        0
                    };
                    let end = if index < last && !ends_with_separator(text) {
                        text.rfind(|c: char| c.is_ascii_whitespace()).unwrap_or(0)
                    } else {
                        text.len()
                    };
                    if start < end {
                        strings.push((text[start..end].to_owned(), quasi.span));
                    }
                }
                // An expression between class separators is a whole class list, e.g.
                // `${active ? 'active' : ''}` in `item ${...}`
                for (index, expression) in template.expressions.iter().enumerate() {
                    let (Some(before), Some(after)) =
                        (template.quasis.get(index), template.quasis.get(index + 1))
                    else {
                        continue;
                    };
                    let before = before.value.raw.as_str();
                    let after = after.value.raw.as_str();
                    let separated_before =
                        (index == 0 && before.is_empty()) || ends_with_separator(before);
                    let separated_after =
                        (index + 1 == last && after.is_empty()) || starts_with_separator(after);
                    if separated_before && separated_after {
                        self.class_strings(expression, in_cx, strings);
                    }
                }
            }
            Expression::ConditionalExpression(conditional) => {
                self.class_strings(&conditional.consequent, in_cx, strings);
                self.class_strings(&conditional.alternate, in_cx, strings);
            }
            Expression::LogicalExpression(logical) => {
                if logical.operator != LogicalOperator::And {
                    self.class_strings(&logical.left, in_cx, strings);
                }
                self.class_strings(&logical.right, in_cx, strings);
            }
            Expression::ObjectExpression(object) if in_cx => {
                for property in &object.properties {
                    if let ObjectPropertyKind::ObjectProperty(property) = property
                        && !is_falsy_literal(&property.value)
                        && let Some(key) = property.key.static_name()
                    {
                        strings.push((key.into_owned(), property.key.span()));
                    }
                }
            }
            Expression::CallExpression(call)
                if self.context.imports.get_expression(&call.callee) == Some("cx") =>
            {
                for argument in &call.arguments {
                    if let Some(expression) = argument.as_expression() {
                        self.class_strings(expression, true, strings);
                    }
                }
            }
            _ => {}
        }
    }
}

struct CssReferenceCollector<'c, 'r> {
    constants: &'c FxHashMap<String, StaticValue>,
    scoping: &'c Scoping,
    references: &'r mut Vec<UsedCssReference<'c>>,
}

impl<'a> Visit<'a> for CssReferenceCollector<'_, '_> {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        if let Some(StaticValue::CssClass { name, css, .. }) =
            resolved_constant(identifier, self.constants, self.scoping)
        {
            self.references.push(UsedCssReference {
                identifier: identifier.name.to_string(),
                span: identifier.span,
                class_name: name,
                css,
            });
        }
    }
}

fn starts_with_separator(text: &str) -> bool {
    text.starts_with(|c: char| c.is_ascii_whitespace())
}

fn ends_with_separator(text: &str) -> bool {
    text.ends_with(|c: char| c.is_ascii_whitespace())
}

/// The class as an object key, quoted when it isn't an identifier, e.g. `"is-active"`
fn property_key(class: &str) -> Cow<'_, str> {
    let is_identifier = class
        .chars()
        .next()
        .is_some_and(|first| !first.is_ascii_digit())
        && class
            .chars()
            .all(|char| char.is_ascii_alphanumeric() || char == '_' || char == '$');
    if is_identifier {
        Cow::Borrowed(class)
    } else {
        Cow::Owned(format!("\"{class}\""))
    }
}

/// The keys an element's own cx prop hashes, e.g. `active` in `<div css={...} cx={{ active }} />`
fn own_hashed_keys(element: &JSXElement<'_>) -> impl Iterator<Item = String> {
    let object = find_attributes(element, "cx").find_map(|attribute| match &attribute.value {
        Some(JSXAttributeValue::ExpressionContainer(container)) => match &container.expression {
            JSXExpression::ObjectExpression(object) => Some(object),
            _ => None,
        },
        _ => None,
    });
    object
        .into_iter()
        .flat_map(|object| &object.properties)
        .filter_map(|property| match property {
            ObjectPropertyKind::ObjectProperty(property) if !property.computed => {
                property.key.static_name().map(Cow::into_owned)
            }
            _ => None,
        })
        .filter(|key| !key.starts_with('$'))
}

/// `false`, `null`, `undefined`, `0` and `''`, which `cx()` skips
fn is_falsy_literal(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(literal) => !literal.value,
        Expression::NullLiteral(_) => true,
        Expression::Identifier(identifier) => identifier.name == "undefined",
        Expression::NumericLiteral(literal) => literal.value == 0.0,
        Expression::StringLiteral(literal) => literal.value.is_empty(),
        _ => false,
    }
}
