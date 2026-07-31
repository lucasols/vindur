use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformOptions {
    pub dev: bool,
    pub sourcemap: bool,
    pub normalize_code: bool,
    pub import_aliases: FxHashMap<String, String>,
}
