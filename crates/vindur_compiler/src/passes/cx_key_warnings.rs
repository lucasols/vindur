use oxc_span::Span;
use rustc_hash::FxHashSet;

use crate::CompilerDiagnostic;

/// cx prop keys of a file, `$` keys keep their name and the others are hashed
#[derive(Default)]
pub(crate) struct CxKeyUsages {
    pub hashed: Vec<(String, Span)>,
    pub unhashed: FxHashSet<String>,
}

/// A hashed cx key only rewrites the `&.key` selectors of its own styles, so a raw
/// `.key` class elsewhere in the file's css, e.g. `.key &` in another component,
/// never matches it
pub(super) fn raw_hashed_cx_key_warnings(
    usages: &CxKeyUsages,
    css: &str,
    file_path: &str,
    source: &str,
) -> Vec<CompilerDiagnostic> {
    let mut warned = FxHashSet::default();
    usages
        .hashed
        .iter()
        .filter(|(name, _)| {
            !usages.unhashed.contains(name)
                && contains_class(css, name)
                && warned.insert(name.as_str())
        })
        .map(|(name, span)| {
            CompilerDiagnostic::warning(
                file_path,
                source,
                *span,
                format!(
                    "cx key \"{name}\" is hashed, but the class \".{name}\" is used in other selectors of this file, which will never match it. Use \"${name}\" to keep the class name, or rename one of the classes"
                ),
            )
        })
        .collect()
}

fn contains_class(css: &str, name: &str) -> bool {
    let selector = format!(".{name}");
    css.match_indices(&selector).any(|(index, _)| {
        css[index + selector.len()..]
            .chars()
            .next()
            .is_none_or(|next| !(next.is_ascii_alphanumeric() || next == '-' || next == '_'))
    })
}
