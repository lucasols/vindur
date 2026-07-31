mod compiler;
mod diagnostic;
mod edit;
mod facts;
mod hash;
mod normalize;
mod options;
mod passes;
mod resolver;

pub use compiler::{Compiler, TransformOutput};
pub use diagnostic::{CompilerDiagnostic, DiagnosticSeverity, SourcePosition};
pub use facts::{ModuleFacts, ModuleId};
pub use options::TransformOptions;
pub use resolver::SourceLoader;
