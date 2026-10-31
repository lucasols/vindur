use oxc_ast::ast::{
    ArrayExpressionElement, BindingPattern, Declaration, ExportDefaultDeclarationKind, Expression,
    ObjectPropertyKind, Program, PropertyKind, Statement, UnaryOperator, VariableDeclaration,
    VariableDeclarationKind,
};
use rustc_hash::FxHashMap;

use crate::{facts::StaticValue, semantic::VindurImports};

/// Whether evaluating the module can do more than declaring bindings. Only a small set of
/// statements counts as free of side effects: declarations of literals, identifiers,
/// functions, object or array literals of those, statically evaluated constants and vindur
/// calls, type declarations and exports of these. `createGlobalStyle` statements are
/// compiled to CSS instead, and imports are checked by the compiler
pub(super) fn has_top_level_side_effects(
    program: &Program<'_>,
    imports: &VindurImports<'_>,
    constants: &FxHashMap<String, StaticValue>,
) -> bool {
    let check = PurityCheck { imports, constants };
    !program
        .body
        .iter()
        .all(|statement| check.is_pure_statement(statement))
}

struct PurityCheck<'a> {
    imports: &'a VindurImports<'a>,
    /// Static evaluation only supports expressions without side effects
    constants: &'a FxHashMap<String, StaticValue>,
}

impl PurityCheck<'_> {
    fn is_pure_statement(&self, statement: &Statement<'_>) -> bool {
        match statement {
            Statement::ImportDeclaration(_) | Statement::EmptyStatement(_) => true,
            Statement::ExpressionStatement(statement) => matches!(
                &statement.expression,
                Expression::TaggedTemplateExpression(tagged)
                    if self.imports.get_expression(&tagged.tag) == Some("createGlobalStyle")
            ),
            Statement::ExportNamedDeclaration(export) => {
                if export.source.is_some() {
                    export.export_kind.is_type()
                } else {
                    export
                        .declaration
                        .as_ref()
                        .is_none_or(|declaration| self.is_pure_declaration(declaration))
                }
            }
            Statement::ExportAllDeclaration(export) => export.export_kind.is_type(),
            Statement::ExportDefaultDeclaration(export) => match &export.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(_)
                | ExportDefaultDeclarationKind::TSInterfaceDeclaration(_) => true,
                ExportDefaultDeclarationKind::ClassDeclaration(class) => class.declare,
                declaration => declaration
                    .as_expression()
                    .is_some_and(|expression| self.is_pure_expression(expression)),
            },
            statement => statement
                .as_declaration()
                .is_some_and(|declaration| self.is_pure_declaration(declaration)),
        }
    }

    fn is_pure_declaration(&self, declaration: &Declaration<'_>) -> bool {
        match declaration {
            Declaration::VariableDeclaration(declaration) => {
                self.is_pure_variable_declaration(declaration)
            }
            Declaration::FunctionDeclaration(_)
            | Declaration::TSTypeAliasDeclaration(_)
            | Declaration::TSInterfaceDeclaration(_)
            | Declaration::TSGlobalDeclaration(_) => true,
            Declaration::TSEnumDeclaration(declaration) => {
                declaration.declare
                    || declaration.body.members.iter().all(|member| {
                        member
                            .initializer
                            .as_ref()
                            .is_none_or(|initializer| self.is_pure_expression(initializer))
                    })
            }
            Declaration::ClassDeclaration(class) => class.declare,
            Declaration::TSModuleDeclaration(declaration) => declaration.declare,
            Declaration::TSImportEqualsDeclaration(_) => false,
        }
    }

    fn is_pure_variable_declaration(&self, declaration: &VariableDeclaration<'_>) -> bool {
        if declaration.declare {
            return true;
        }
        if matches!(
            declaration.kind,
            VariableDeclarationKind::Using | VariableDeclarationKind::AwaitUsing
        ) {
            return false;
        }
        declaration.declarations.iter().all(|declarator| {
            let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                return false;
            };
            declarator.init.as_ref().is_none_or(|init| {
                (declaration.kind == VariableDeclarationKind::Const
                    && self.constants.contains_key(identifier.name.as_str()))
                    || self.is_pure_expression(init)
            })
        })
    }

    fn is_pure_expression(&self, expression: &Expression<'_>) -> bool {
        match expression.get_inner_expression() {
            Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::StringLiteral(_)
            | Expression::RegExpLiteral(_)
            | Expression::Identifier(_)
            | Expression::ArrowFunctionExpression(_)
            | Expression::FunctionExpression(_) => true,
            // Converting other values to strings can call a user-defined `toString`
            Expression::TemplateLiteral(template) => {
                template.expressions.iter().all(is_primitive_literal)
            }
            Expression::UnaryExpression(unary) => {
                unary.operator == UnaryOperator::UnaryNegation
                    && matches!(
                        unary.argument.get_inner_expression(),
                        Expression::NumericLiteral(_) | Expression::BigIntLiteral(_)
                    )
            }
            Expression::ObjectExpression(object) => {
                object.properties.iter().all(|property| match property {
                    // Vindur calls read their arguments, e.g. `attrs`, which runs getters
                    ObjectPropertyKind::ObjectProperty(property) => {
                        property.kind == PropertyKind::Init
                            && (!property.computed
                                || property
                                    .key
                                    .as_expression()
                                    .is_some_and(is_primitive_literal))
                            && self.is_pure_expression(&property.value)
                    }
                    ObjectPropertyKind::SpreadProperty(_) => false,
                })
            }
            Expression::ArrayExpression(array) => {
                array.elements.iter().all(|element| match element {
                    ArrayExpressionElement::Elision(_) => true,
                    ArrayExpressionElement::SpreadElement(_) => false,
                    element => element
                        .as_expression()
                        .is_some_and(|expression| self.is_pure_expression(expression)),
                })
            }
            // Template interpolations of vindur styles are validated as static values
            Expression::TaggedTemplateExpression(tagged) => self.is_vindur_callee(&tagged.tag),
            Expression::CallExpression(call) => {
                self.is_vindur_callee(&call.callee)
                    && call.arguments.iter().all(|argument| {
                        argument
                            .as_expression()
                            .is_some_and(|expression| self.is_pure_expression(expression))
                    })
            }
            _ => false,
        }
    }

    /// vindur imports and their chains, e.g. `styled.button.attrs({ type: 'button' })`
    fn is_vindur_callee(&self, expression: &Expression<'_>) -> bool {
        match expression.get_inner_expression() {
            // Runtime helpers read their arguments, which can run getters
            identifier @ Expression::Identifier(_) => self
                .imports
                .get_expression(identifier)
                .is_some_and(|name| !matches!(name, "cx" | "mergeClassNames" | "mergeStyles")),
            // Only `styled.tag` and `.attrs()` chains, others like `fn.call` can run any code
            Expression::StaticMemberExpression(member) => {
                match member.object.get_inner_expression() {
                    identifier @ Expression::Identifier(_) => {
                        self.imports.get_expression(identifier) == Some("styled")
                    }
                    object => member.property.name == "attrs" && self.is_vindur_callee(object),
                }
            }
            call @ Expression::CallExpression(_) => self.is_pure_expression(call),
            _ => false,
        }
    }
}

fn is_primitive_literal(expression: &Expression<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::StringLiteral(_)
    )
}
