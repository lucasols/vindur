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
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", tag = "type", content = "value")]
pub enum StaticValue {
    Array(Vec<StaticValue>),
    Boolean(bool),
    ClassName(String),
    CssClass {
        name: String,
        css: String,
    },
    DynamicColor {
        id: String,
    },
    DynamicColorPath {
        id: String,
        path: String,
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
    },
    InvalidObject {
        source_path: String,
    },
    Number(f64),
    Object(FxHashMap<String, StaticValue>),
    String(String),
    ThemeColor {
        name: String,
        hex: String,
    },
    ThemeColorContrast {
        name: String,
        hex: String,
    },
    ThemeColors(FxHashMap<String, String>),
    UnexportedThemeColors(FxHashMap<String, String>),
    Undefined,
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
    Inequality,
    Multiplication,
    StrictEquality,
    StrictInequality,
    Subtraction,
}
