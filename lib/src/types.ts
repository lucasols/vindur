export type TernaryConditionValue =
  | { type: 'string' | 'number' | 'boolean'; value: string | number | boolean }
  | { type: 'arg'; name: string };

export type OutputQuasi =
  | { type: 'string'; value: string }
  | { type: 'arg'; name: string }
  | { type: 'template'; parts: OutputQuasi[] }
  | {
      type: 'ternary';
      condition: [
        TernaryConditionValue,
        '===' | '!==' | '>' | '<' | '>=' | '<=',
        TernaryConditionValue,
      ];
      ifTrue: OutputQuasi;
      ifFalse: OutputQuasi;
    }
  | {
      type: 'binary';
      operator: '+' | '-' | '*' | '/';
      left: TernaryConditionValue;
      right: TernaryConditionValue;
    };

export type FunctionArg = {
  name?: string; // Parameter name for positional args
  type: 'string' | 'number' | 'boolean';
  defaultValue: string | number | boolean | undefined;
  optional?: boolean; // Whether the parameter is optional
};

export type CompiledFunction =
  | {
      type: 'destructured';
      args: Record<string, FunctionArg>;
      output: OutputQuasi[];
    }
  | { type: 'positional'; args: FunctionArg[]; output: OutputQuasi[] };
