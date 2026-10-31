use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformOptions {
    pub dev: bool,
    pub sourcemap: bool,
    pub normalize_code: bool,
    pub import_aliases: FxHashMap<String, String>,
    /// Classes `setColorScheme` adds for the scheme of a dynamic color
    pub color_scheme_class_names: Option<ColorSchemeClassNames>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct ColorSchemeClassNames {
    pub light: String,
    pub dark: String,
}
