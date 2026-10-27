use oxc_ast::ast::{ImportDeclaration, ImportDeclarationSpecifier};
use oxc_semantic::Scoping;
use rustc_hash::FxHashSet;

/// Insertion ordered and without duplicates, skips the module itself, which import cycles
/// add through its dependencies' lists
pub(crate) struct DependencyList<'f> {
    file_path: &'f str,
    pub(crate) paths: Vec<String>,
    seen: FxHashSet<String>,
}

impl<'f> DependencyList<'f> {
    pub(crate) fn new(file_path: &'f str) -> Self {
        Self {
            file_path,
            paths: Vec::new(),
            seen: FxHashSet::default(),
        }
    }

    /// Returns whether the dependency was added
    pub(crate) fn insert(&mut self, dependency: &str) -> bool {
        if self.seen.contains(dependency) || paths_refer_to_same_module(dependency, self.file_path)
        {
            return false;
        }
        self.seen.insert(dependency.to_owned());
        self.paths.push(dependency.to_owned());
        true
    }
}

pub(crate) fn paths_refer_to_same_module(left: &str, right: &str) -> bool {
    left == right || without_extension(left) == right || left == without_extension(right)
}

fn without_extension(path: &str) -> &str {
    std::path::Path::new(path)
        .extension()
        .map_or(path, |extension| {
            &path[..path.len() - extension.as_encoded_bytes().len() - 1]
        })
}

/// Type-only imports have no values to resolve, following them only adds work and
/// import cycles
pub(crate) fn is_type_only_import(import: &ImportDeclaration<'_>, scoping: &Scoping) -> bool {
    import.import_kind.is_type()
        || import.specifiers.as_ref().is_some_and(|specifiers| {
            !specifiers.is_empty()
                && specifiers
                    .iter()
                    .all(|specifier| is_type_only_specifier(specifier, scoping))
        })
}

/// Also covers imports without the `type` modifier that are only used as types
pub(crate) fn is_type_only_specifier(
    specifier: &ImportDeclarationSpecifier<'_>,
    scoping: &Scoping,
) -> bool {
    if let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier
        && specifier.import_kind.is_type()
    {
        return true;
    }
    specifier.local().symbol_id.get().is_some_and(|symbol_id| {
        let mut references = scoping.get_resolved_references(symbol_id).peekable();
        references.peek().is_some() && references.all(|reference| !reference.is_value())
    })
}
