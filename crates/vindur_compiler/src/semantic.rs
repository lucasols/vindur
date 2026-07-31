use oxc_ast::ast::{BindingIdentifier, Expression, IdentifierReference};
use oxc_semantic::Scoping;
use oxc_syntax::symbol::SymbolId;
use rustc_hash::FxHashMap;

/// Vindur imports indexed by Oxc's semantic symbol identity.
///
/// Keeping the textual name alongside the symbol map is intentional: generated
/// CSS facts still use source-level names, while every expression lookup uses
/// the resolved symbol. This prevents a shadowed local such as `css` from being
/// mistaken for the `css` imported from Vindur.
pub(crate) struct VindurImports<'a> {
    scoping: &'a Scoping,
    by_symbol: FxHashMap<SymbolId, String>,
    by_local_name: FxHashMap<String, String>,
}

impl<'a> VindurImports<'a> {
    pub(crate) fn new(scoping: &'a Scoping) -> Self {
        Self {
            scoping,
            by_symbol: FxHashMap::default(),
            by_local_name: FxHashMap::default(),
        }
    }

    pub(crate) fn insert(&mut self, local: &BindingIdentifier<'_>, imported: &str) {
        if let Some(symbol_id) = local.symbol_id.get() {
            self.by_symbol.insert(symbol_id, imported.to_owned());
        }
        self.by_local_name
            .insert(local.name.to_string(), imported.to_owned());
    }

    pub(crate) fn get_identifier(&self, identifier: &IdentifierReference<'_>) -> Option<&str> {
        let reference_id = identifier.reference_id.get()?;
        let symbol_id = self.scoping.get_reference(reference_id).symbol_id()?;
        self.by_symbol.get(&symbol_id).map(String::as_str)
    }

    pub(crate) fn get_expression(&self, expression: &Expression<'_>) -> Option<&str> {
        let Expression::Identifier(identifier) = expression else {
            return None;
        };
        self.get_identifier(identifier)
    }

    pub(crate) fn matches_import_or_global(
        &self,
        identifier: &IdentifierReference<'_>,
        expected: &str,
    ) -> bool {
        if self.get_identifier(identifier) == Some(expected) {
            return true;
        }
        if identifier.name.as_str() != expected {
            return false;
        }
        identifier.reference_id.get().is_some_and(|reference_id| {
            self.scoping
                .get_reference(reference_id)
                .symbol_id()
                .is_none()
        })
    }

    pub(crate) fn iter_names(&self) -> impl Iterator<Item = (&str, &str)> {
        self.by_local_name
            .iter()
            .map(|(local, imported)| (local.as_str(), imported.as_str()))
    }
}
