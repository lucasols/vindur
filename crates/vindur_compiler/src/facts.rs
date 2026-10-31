use std::sync::Arc;

use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};

pub type ModuleId = Arc<str>;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleFacts {
    pub declared_exports: Vec<String>,
    #[serde(default)]
    pub declared_object_exports: Vec<String>,
    pub source_hash: u64,
    pub constants: FxHashMap<String, StaticValue>,
    pub exports: FxHashMap<String, StaticValue>,
    pub dependencies: Vec<String>,
    /// Modules whose facts were read directly, including ones whose values aren't static
    #[serde(default)]
    pub fact_dependencies: Vec<String>,
    /// Modules skipped while collecting facts because they're in an import cycle with
    /// this module, their values are missing from it, and imported modules whose facts
    /// depend on an import cycle
    #[serde(default)]
    pub cyclic_dependencies: Vec<String>,
    /// Names re-exported with `export { name } from 'source'` or `export * as name from
    /// 'source'`, keyed by exported name
    #[serde(default)]
    pub re_exports: FxHashMap<String, ReExport>,
    /// Sources of `export * from 'source'`
    #[serde(default)]
    pub star_re_exports: Vec<String>,
    /// Loading the module can do more than declaring its exports: `createGlobalStyle` styles,
    /// top-level code outside the side effect free set, value re-exports, or imports other
    /// than vindur, types and modules without side effects
    #[serde(default)]
    pub has_side_effects: bool,
}

impl ModuleFacts {
    /// Facts collected in an import cycle depend on which module of the cycle was
    /// transformed first
    #[must_use]
    pub fn has_cycle(&self) -> bool {
        !self.cyclic_dependencies.is_empty()
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReExport {
    pub source: String,
    /// Name exported by `source`, `None` for `export * as name from 'source'`
    pub imported_name: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", tag = "type", content = "value")]
pub enum StaticValue {
    Array(Vec<StaticValue>),
    Boolean(bool),
    ClassName {
        name: String,
        /// The flag classes of a styled component, hashed where a reference to it selects them
        style_flags: Vec<StyleFlagClass>,
    },
    CssClass {
        name: String,
        css: String,
        /// The css references keyframes, whose `@keyframes` rule only loads with the modules
        /// that define them
        #[serde(default)]
        uses_keyframes: bool,
    },
    DynamicColor {
        id: String,
        /// Dev selectors use readable class names, e.g. `{id}-self-isDark`
        dev: bool,
    },
    DynamicColorPath {
        id: String,
        path: String,
        dev: bool,
    },
    /// Imported from a module skipped because it's in an import cycle with the importer,
    /// its value depends on which module of the cycle was transformed first
    CyclicImport {
        source_path: String,
    },
    Keyframes(String),
    LayerFunction,
    MissingImport {
        imported_name: String,
        source_path: String,
    },
    Function(CompiledFunction),
    ImportedFunction(CompiledFunction),
    ImportedObject {
        properties: FxHashMap<String, StaticValue>,
        source_path: String,
    },
    ImportedValue {
        source_path: String,
        value: Box<StaticValue>,
    },
    InvalidFunction {
        source_path: String,
        #[serde(default)]
        cyclic_imports: Vec<String>,
    },
    InvalidObject {
        source_path: String,
        #[serde(default)]
        cyclic_imports: Vec<String>,
    },
    Number(f64),
    /// Imported name that only exists through a re-export, `re_export` is `None` when it
    /// may come from `export * from`
    UnsupportedReExport {
        imported_name: String,
        source_path: String,
        re_export: Option<ReExport>,
    },
    Object(FxHashMap<String, StaticValue>),
    String(String),
    ThemeColor {
        name: String,
        /// Normalized hex used for the compiled colors, e.g. `#f00`
        hex: String,
        /// The hex as written in `createStaticThemeColors`, e.g. `#FF0000`
        default_hex: String,
        /// Dev values keep the color name, e.g. `var(--stc-primary-var, #f00)`
        dev: bool,
    },
    ThemeColorContrast {
        name: String,
        hex: String,
        base_hex: String,
        dev: bool,
    },
    ThemeColors {
        /// Color names to their hex as written, validated by `parse_theme_colors`
        colors: FxHashMap<String, String>,
        dev: bool,
    },
    UnexportedThemeColors {
        colors: FxHashMap<String, String>,
        dev: bool,
    },
    Undefined,
}

/// A class applied by a style flag, e.g. `size-small` for `size: 'small' | 'large'`
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleFlagClass {
    /// The class as written in the CSS, e.g. `size-small`
    pub original: String,
    pub hashed: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompiledFunction {
    pub parameters: Vec<FunctionParameter>,
    pub body: FunctionExpression,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum FunctionParameter {
    Identifier {
        name: String,
        default: Option<FunctionExpression>,
    },
    Object {
        properties: Vec<FunctionObjectProperty>,
        default: Option<FunctionExpression>,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FunctionObjectProperty {
    pub source: String,
    pub binding: String,
    pub default: Option<FunctionExpression>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum FunctionExpression {
    Array {
        elements: Vec<FunctionExpression>,
    },
    Boolean {
        value: bool,
    },
    Binary {
        left: Box<FunctionExpression>,
        operator: FunctionOperator,
        right: Box<FunctionExpression>,
    },
    Conditional {
        test: Box<FunctionExpression>,
        consequent: Box<FunctionExpression>,
        alternate: Box<FunctionExpression>,
    },
    IsArray {
        value: Box<FunctionExpression>,
    },
    Join {
        array: Box<FunctionExpression>,
        separator: Box<FunctionExpression>,
    },
    Map {
        array: Box<FunctionExpression>,
        parameter: String,
        body: Box<FunctionExpression>,
    },
    Number {
        value: f64,
    },
    Object {
        properties: Vec<FunctionObjectExpressionProperty>,
    },
    Parameter {
        name: String,
    },
    String {
        value: String,
    },
    Undefined,
    Template {
        quasis: Vec<String>,
        expressions: Vec<FunctionExpression>,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FunctionObjectExpressionProperty {
    pub name: String,
    pub value: FunctionExpression,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FunctionOperator {
    Addition,
    Division,
    Equality,
    GreaterEqualThan,
    GreaterThan,
    Inequality,
    LessEqualThan,
    LessThan,
    Multiplication,
    StrictEquality,
    StrictInequality,
    Subtraction,
}
