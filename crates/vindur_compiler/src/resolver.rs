use std::path::{Component, Path, PathBuf};

use rustc_hash::FxHashMap;

pub trait SourceLoader {
    fn exists(&mut self, file_path: &str) -> Result<bool, String>;
    fn read_file(&mut self, file_path: &str) -> Result<String, String>;
}

pub(crate) struct NoopLoader;

impl SourceLoader for NoopLoader {
    fn exists(&mut self, _file_path: &str) -> Result<bool, String> {
        Ok(false)
    }

    fn read_file(&mut self, file_path: &str) -> Result<String, String> {
        Err(format!("File not found: {file_path}"))
    }
}

pub(crate) fn resolve_import_path(
    importer: &str,
    specifier: &str,
    aliases: &FxHashMap<String, String>,
    loader: &mut impl SourceLoader,
) -> Result<Option<String>, String> {
    let Some(normalized) = unresolved_import_path(importer, specifier, aliases) else {
        return Ok(None);
    };
    let candidates = import_candidates(&normalized);
    for candidate in candidates {
        if loader.exists(&candidate)? {
            return Ok(Some(candidate));
        }
    }
    Ok(None)
}

pub(crate) fn unresolved_import_path(
    importer: &str,
    specifier: &str,
    aliases: &FxHashMap<String, String>,
) -> Option<String> {
    let alias = aliases
        .iter()
        .filter(|(prefix, _)| specifier.starts_with(prefix.as_str()))
        .max_by_key(|(prefix, _)| prefix.len());
    let unresolved = if let Some((prefix, replacement)) = alias {
        format!("{replacement}{}", &specifier[prefix.len()..])
    } else if specifier.starts_with('.') {
        let parent = Path::new(importer)
            .parent()
            .unwrap_or_else(|| Path::new("/"));
        parent.join(specifier).to_string_lossy().into_owned()
    } else {
        return None;
    };
    Some(normalize_path(&unresolved))
}

pub(crate) fn has_source_extension(path: &str) -> bool {
    Path::new(path).extension().is_some_and(|extension| {
        matches!(
            extension.to_str(),
            Some("ts" | "tsx" | "js" | "jsx" | "mts" | "cts" | "mjs" | "cjs")
        )
    })
}

fn import_candidates(path: &str) -> Vec<String> {
    if has_source_extension(path) {
        return vec![path.to_owned()];
    }
    [
        format!("{path}.ts"),
        format!("{path}.tsx"),
        format!("{path}.js"),
        format!("{path}.jsx"),
        format!("{path}/index.ts"),
        format!("{path}/index.tsx"),
        format!("{path}/index.js"),
        format!("{path}/index.jsx"),
    ]
    .into()
}

fn normalize_path(path: &str) -> String {
    let mut normalized = PathBuf::new();
    for component in Path::new(path).components() {
        match component {
            Component::ParentDir => {
                normalized.pop();
            }
            Component::CurDir => {}
            component => normalized.push(component.as_os_str()),
        }
    }
    normalized.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use rustc_hash::{FxHashMap, FxHashSet};

    use super::{SourceLoader, resolve_import_path};

    struct Files(FxHashSet<String>);

    impl SourceLoader for Files {
        fn exists(&mut self, file_path: &str) -> Result<bool, String> {
            Ok(self.0.contains(file_path))
        }

        fn read_file(&mut self, file_path: &str) -> Result<String, String> {
            Err(format!("unused read: {file_path}"))
        }
    }

    #[test]
    fn resolves_aliases_and_typescript_extensions() {
        let mut files = Files(FxHashSet::from_iter(["/styles/colors.ts".to_owned()]));
        let aliases = FxHashMap::from_iter([("#/".to_owned(), "/".to_owned())]);
        let result = resolve_import_path("/src/app.tsx", "#/styles/colors", &aliases, &mut files)
            .expect("valid lookup");

        assert_eq!(result.as_deref(), Some("/styles/colors.ts"));
    }

    #[test]
    fn resolves_dotted_module_names_without_treating_the_suffix_as_an_extension() {
        let mut files = Files(FxHashSet::from_iter([
            "/src/taskAutoContentFromImages.utils.ts".to_owned(),
        ]));
        let result = resolve_import_path(
            "/src/app.tsx",
            "./taskAutoContentFromImages.utils",
            &FxHashMap::default(),
            &mut files,
        )
        .expect("valid lookup");

        assert_eq!(
            result.as_deref(),
            Some("/src/taskAutoContentFromImages.utils.ts")
        );
    }
}
