export type TernaryConditionValue =
  | { type: 'string' | 'number' | 'boolean'; value: string | number | boolean }
  | { type: 'arg'; name: string }
  | { type: 'isArray'; arg: string };

export type OutputQuasi =
  | { type: 'string'; value: string }
  | { type: 'arg'; name: string }
  | { type: 'template'; parts: OutputQuasi[] }
  | {
      type: 'ternary';
      condition: [
        TernaryConditionValue,
        '===' | '!==' | '>' | '<' | '>=' | '<=' | 'isArray',
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
    }
  | {
      type: 'arrayMethod';
      arg: string;
      method: 'join';
      separator: string;
    }
  | {
      type: 'mapJoin';
      arg: string;
      mapParam: string;
      mapTemplate: OutputQuasi[];
      joinSeparator: string;
    }
  | {
      type: 'arrayMap';
      arg: string;
      mapParam: string;
      mapTemplate: OutputQuasi[];
    };

export type FunctionArg = {
  name?: string; // Parameter name for positional args
  type: 'string' | 'number' | 'boolean' | 'array';
  defaultValue: string | number | boolean | (string | number)[] | undefined;
  optional?: boolean; // Whether the parameter is optional
};

export type CompiledFunction =
  | {
      type: 'destructured';
      args: Record<string, FunctionArg>;
      output: OutputQuasi[];
    }
  | { type: 'positional'; args: FunctionArg[]; output: OutputQuasi[] };
