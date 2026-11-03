use oxc_ast::ast::{
    Argument, BinaryOperator, BindingPattern, Expression, JSXAttributeValue, JSXElement,
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
    jsx_cx::rendered_styled_components,
    jsx_cx_component_references::HashedStyledModifier,
    jsx_cx_css_references::{
        CssReference, css_references, expression_css_references, wrapped_css_references,
    },
    styled::StyledComponent,
    styled_jsx_helpers::decode_jsx_entities,
};

/// A cx key hashed in the rules of a local css reference, which are renamed in place for every
/// element using it
pub(crate) struct HashedCssReferenceKey {
    /// The class name of the css reference
    pub css_class: String,
    pub key: String,
    /// If the rules of the css reference had the key renamed, e.g. `&.key`. The css references of
    /// styled components and the wrapped ones are not renamed, but their elements get the hashed
    /// class
    pub renamed: bool,
    /// The element whose cx prop hashes it
    pub element_name: String,
}

/// Fails for a class written as a string in the `className` of an element whose `&.class` styles
/// a cx prop hashes, e.g. `<Box className="active" />` with `<Box cx={{ active }} />`,
/// `<div css={...} cx={{ active }} className="active" />` or
/// `<div className={cx(card, 'active')} />` with `<div className={card} cx={{ active }} />`. Also
/// checks the `className` of the styled component `.attrs()`
///
/// Returns the `(css class, key)` pairs of the css references in the `.attrs()` className of
/// styled components whose cx props hash the key, their elements get the hashed class but their
/// rules are not renamed
pub(crate) fn static_hashed_class_name_error(
    program: &Program<'_>,
    context: StaticClassNameContext<'_>,
) -> Result<Vec<(String, String)>, CompilerDiagnostic> {
    if !context.has_hashed_keys {
        return Ok(Vec::new());
    }
    let mut visitor = StaticClassNameVisitor {
        context,
        attrs_owners: Vec::new(),
        diagnostic: None,
    };
    visitor.visit_program(program);
    match visitor.diagnostic {
        Some(diagnostic) => Err(diagnostic),
        None => Ok(visitor.attrs_owners),
    }
}

pub(crate) struct StaticClassNameContext<'a> {
    pub imports: &'a VindurImports<'a>,
    pub styled_components: &'a FxHashMap<String, StyledComponent>,
    pub constants: &'a FxHashMap<String, StaticValue>,
    pub scoping: &'a Scoping,
    pub exported_names: &'a FxHashMap<String, String>,
    pub modifiers: &'a [HashedStyledModifier],
    pub css_reference_keys: &'a [HashedCssReferenceKey],
    pub has_hashed_keys: bool,
    pub file_path: &'a str,
    pub source: &'a str,
}

struct StaticClassNameVisitor<'a> {
    context: StaticClassNameContext<'a>,
    attrs_owners: Vec<(String, String)>,
    diagnostic: Option<CompilerDiagnostic>,
}

/// A hashed cx key, the element whose cx prop hashes it and the css reference declaring it, if
/// it's not a key of the element styles
struct HashedKey {
    name: String,
    owner: String,
    css_reference: Option<String>,
    /// If some styles of the element have the key renamed, so a static class of it never matches
    /// them. The elements of a styled component get the hashed class anyway
    renamed: bool,
    /// A key of the element's own cx prop, a static class of it is never the cx class, whether
    /// or not its styles declare `&.key`
    own: bool,
}

/// Where the static classes are written, for the fix suggested in the error
#[derive(Clone, Copy)]
enum ClassSource {
    Element,
    Attrs,
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

impl StaticClassNameVisitor<'_> {
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
            css_reference: None,
            renamed: true,
            own: true,
        }));
        let mut strings = Vec::new();
        for attribute in find_attributes(element, "className") {
            match &attribute.value {
                Some(JSXAttributeValue::StringLiteral(literal)) => {
                    strings.push((decode_jsx_entities(&literal.value), literal.span));
                }
                Some(JSXAttributeValue::ExpressionContainer(container)) => {
                    if let Some(expression) = container.expression.as_expression() {
                        self.class_strings(expression, false, &mut strings);
                    }
                }
                _ => {}
            }
        }
        if strings.is_empty() {
            return;
        }
        // The css references that add their class to the element, a css reference interpolated
        // in a css prop template is copied into the element styles
        let context = &self.context;
        let mut references = css_references(
            element,
            context.constants,
            context.scoping,
            context.exported_names,
        );
        references.extend(wrapped_css_references(
            element,
            context.constants,
            context.scoping,
            context.exported_names,
        ));
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
                references.extend(expression_css_references(
                    &property.value,
                    self.context.constants,
                    self.context.scoping,
                    self.context.exported_names,
                ));
            }
        }
        let hashed = self.styled_hashed_keys(styled, true);
        for reference in &references {
            self.attrs_owners.extend(
                hashed
                    .iter()
                    .map(|key| (reference.name.clone(), key.name.clone())),
            );
        }
        if let Some((reference, key)) = self.attrs_reference_modifier(&references, &hashed) {
            self.diagnostic = Some(CompilerDiagnostic::error(
                self.context.file_path,
                self.context.source,
                reference.span,
                format!(
                    "css reference \"{identifier}\" in the .attrs() className of \"{name}\" declares the \"&.{key}\" modifier, which the cx prop of \"{owner}\" hashes, so it never matches the elements of \"{name}\". Move the modifier styles into the styled component, or use \"${key}\" in the cx prop to keep the class name",
                    identifier = reference.identifier,
                    owner = key.owner,
                    key = key.name
                ),
            ));
            return;
        }
        // The elements with the cx prop get the `.attrs()` classes too, so a static class of a
        // key that their styles don't declare is still never the cx class
        let hashed = hashed
            .into_iter()
            .map(|key| HashedKey {
                own: !key.renamed,
                renamed: true,
                ..key
            })
            .collect::<Vec<_>>();
        self.report(name, &hashed, &strings, ClassSource::Attrs);
    }

    /// A css reference in `.attrs()` that declares a modifier hashed by a cx prop, of the styled
    /// component or of the css reference itself. Its rules are not renamed for the styled
    /// component cx props, and when another element hashes it, the styled component can't add the
    /// hashed class
    fn attrs_reference_modifier<'r>(
        &self,
        references: &'r [CssReference],
        styled_keys: &[HashedKey],
    ) -> Option<(&'r CssReference, HashedKey)> {
        for reference in references {
            if let Some(key) = self
                .css_reference_hashed_keys(std::slice::from_ref(reference))
                .into_iter()
                .next()
            {
                return Some((reference, key));
            }
            if styled_keys.is_empty() {
                continue;
            }
            // Invalid css is reported with its location by the css pass
            let declared =
                element_class_names(&reference.css, ModifierCss::Block).unwrap_or_default();
            if let Some(key) = styled_keys.iter().find(|key| declared.contains(&key.name)) {
                return Some((
                    reference,
                    HashedKey {
                        name: key.name.clone(),
                        owner: key.owner.clone(),
                        css_reference: None,
                        renamed: key.renamed,
                        own: false,
                    },
                ));
            }
        }
        None
    }

    /// The hashed keys of the cx props of a styled component, also of the components it extends
    /// and the styled component it renders with `withComponent()`. With `extending`, also the
    /// keys of the components whose elements get its `.attrs()`: the ones extending it or
    /// rendering it with `withComponent()`
    fn styled_hashed_keys(&self, styled: &StyledComponent, extending: bool) -> Vec<HashedKey> {
        let mut classes = Vec::new();
        match styled.class_name.split_whitespace().last() {
            Some(own_class) if extending => {
                for component in self.context.styled_components.values() {
                    let mut rendered = Vec::new();
                    self.element_classes(component, &mut rendered);
                    if rendered.contains(&own_class) {
                        classes.extend(rendered);
                    }
                }
            }
            _ => self.element_classes(styled, &mut classes),
        }
        self.context
            .modifiers
            .iter()
            .filter(|modifier| {
                modifier
                    .classes
                    .last()
                    .is_some_and(|owner| classes.contains(&owner.as_str()))
            })
            .map(|modifier| HashedKey {
                name: modifier.class_name.clone(),
                owner: modifier.element_name.clone(),
                css_reference: None,
                renamed: modifier.renamed,
                own: false,
            })
            .collect()
    }

    /// The styled component classes the elements of a styled component get, also of the local
    /// styled component it renders, like `Box` in `Plain.withComponent(Box)`
    fn element_classes<'s>(&'s self, styled: &'s StyledComponent, classes: &mut Vec<&'s str>) {
        for component in rendered_styled_components(styled, self.context.styled_components) {
            classes.extend(component.class_name.split_whitespace());
        }
    }

    /// The hashed keys renamed in the rules of the css references
    fn css_reference_hashed_keys(&self, references: &[CssReference]) -> Vec<HashedKey> {
        references
            .iter()
            .flat_map(|reference| {
                self.context
                    .css_reference_keys
                    .iter()
                    .filter(|key| key.renamed && key.css_class == reference.name)
                    .map(|key| HashedKey {
                        name: key.key.clone(),
                        owner: key.element_name.clone(),
                        css_reference: Some(reference.identifier.clone()),
                        renamed: true,
                        own: false,
                    })
            })
            .collect()
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
                let Some(key) = hashed.iter().find(|key| key.renamed && key.name == class) else {
                    continue;
                };
                let owner = &key.owner;
                let styles = match &key.css_reference {
                    Some(reference) => {
                        format!("the \"&.{class}\" styles of the css reference \"{reference}\"")
                    }
                    None => format!("the \"&.{class}\" styles"),
                };
                let message = match source {
                    ClassSource::Element if key.own => format!(
                        "class \"{class}\" on \"{name}\" is also a key of its cx prop, which hashes it, so the static class is never the cx class. Add it with the cx prop instead, e.g. cx={{{{ {key}: condition }}}}, or use \"${class}\" in the cx prop to keep the class name",
                        key = property_key(class)
                    ),
                    ClassSource::Element => format!(
                        "class \"{class}\" on \"{name}\" never matches {styles}, as the cx prop of \"{owner}\" hashes it. Add it with the cx prop instead, e.g. cx={{{{ {key}: condition }}}}, or use \"${class}\" in the cx prop to keep the class name",
                        key = property_key(class)
                    ),
                    ClassSource::Attrs if key.own => format!(
                        "class \"{class}\" in the .attrs() of \"{name}\" is also a key of the cx prop of \"{owner}\", which hashes it, so the static class is never the cx class. Remove it from .attrs() and add it with the cx prop where it's needed, or use \"${class}\" in the cx prop to keep the class name"
                    ),
                    ClassSource::Attrs => format!(
                        "class \"{class}\" in the .attrs() of \"{name}\" never matches {styles} of \"{owner}\", as its cx prop hashes it. Remove it from .attrs() and add it with the cx prop where it's needed, or use \"${class}\" in the cx prop to keep the class name"
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
                let mut pieces = Vec::new();
                for (index, quasi) in template.quasis.iter().enumerate() {
                    let text = quasi.value.cooked.as_ref().unwrap_or(&quasi.value.raw);
                    pieces.push(ClassPiece::Text(Cow::Borrowed(text.as_str()), quasi.span));
                    if let Some(expression) = template.expressions.get(index) {
                        pieces.push(ClassPiece::Expression(expression));
                    }
                }
                self.joined_class_strings(&pieces, in_cx, strings);
            }
            Expression::BinaryExpression(binary) if binary.operator == BinaryOperator::Addition => {
                let mut pieces = Vec::new();
                concatenation_pieces(expression.get_inner_expression(), &mut pieces);
                self.joined_class_strings(&pieces, in_cx, strings);
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

    /// The classes of strings joined with other values, like a template literal or a `+`
    /// concatenation. Classes joined to another value, like `item-` in `item-${id}`, are not
    /// known, and a value between class separators is a whole class list, e.g.
    /// `${active ? 'active' : ''}` in `item ${...}`
    fn joined_class_strings(
        &self,
        pieces: &[ClassPiece<'_, '_>],
        in_cx: bool,
        strings: &mut Vec<(String, Span)>,
    ) {
        let last = pieces.len().saturating_sub(1);
        for (index, piece) in pieces.iter().enumerate() {
            match piece {
                ClassPiece::Text(text, span) => {
                    push_separated_classes(text, *span, index == 0, index == last, strings);
                }
                ClassPiece::Expression(expression) => {
                    let separated_before = match index.checked_sub(1).map(|before| &pieces[before])
                    {
                        None => true,
                        Some(ClassPiece::Text(text, _)) => {
                            (index == 1 && text.is_empty()) || ends_with_separator(text)
                        }
                        Some(ClassPiece::Expression(_)) => false,
                    };
                    let separated_after = match pieces.get(index + 1) {
                        None => true,
                        Some(ClassPiece::Text(text, _)) => {
                            (index + 1 == last && text.is_empty()) || starts_with_separator(text)
                        }
                        Some(ClassPiece::Expression(_)) => false,
                    };
                    // The strings of a joined expression can still hold separated classes,
                    // like `' active'` in `id + (a ? ' active' : '')`
                    let mut inner = Vec::new();
                    self.class_strings(expression, in_cx, &mut inner);
                    for (text, span) in inner {
                        push_separated_classes(
                            &text,
                            span,
                            separated_before,
                            separated_after,
                            strings,
                        );
                    }
                }
            }
        }
    }
}

/// Pushes the classes of a text, without its first class when it's joined to the value before
/// it and its last class when it's joined to the value after it, e.g. only `b` of `a b c` in
/// `${x}a b c${y}`
fn push_separated_classes(
    text: &str,
    span: Span,
    separated_before: bool,
    separated_after: bool,
    strings: &mut Vec<(String, Span)>,
) {
    let start = if separated_before || starts_with_separator(text) {
        0
    } else {
        text.find(|c: char| c.is_ascii_whitespace())
            .unwrap_or(text.len())
    };
    let end = if separated_after || ends_with_separator(text) {
        text.len()
    } else {
        text.rfind(|c: char| c.is_ascii_whitespace()).unwrap_or(0)
    };
    if start < end {
        strings.push((text[start..end].to_owned(), span));
    }
}

/// A part of a joined class string
enum ClassPiece<'s, 'a> {
    Text(Cow<'s, str>, Span),
    Expression(&'s Expression<'a>),
}

/// The operands of a `+` concatenation, string literals are texts
fn concatenation_pieces<'s, 'a>(
    expression: &'s Expression<'a>,
    pieces: &mut Vec<ClassPiece<'s, 'a>>,
) {
    match expression.get_inner_expression() {
        Expression::BinaryExpression(binary) if binary.operator == BinaryOperator::Addition => {
            concatenation_pieces(&binary.left, pieces);
            concatenation_pieces(&binary.right, pieces);
        }
        // Adjacent literals are one text, like `' ' + 'active'` in `id + ' ' + 'active'`
        Expression::StringLiteral(literal) => match pieces.last_mut() {
            Some(ClassPiece::Text(text, span)) => {
                text.to_mut().push_str(literal.value.as_str());
                span.end = literal.span.end;
            }
            _ => pieces.push(ClassPiece::Text(
                Cow::Borrowed(literal.value.as_str()),
                literal.span,
            )),
        },
        expression => pieces.push(ClassPiece::Expression(expression)),
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
