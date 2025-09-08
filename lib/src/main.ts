import {
  createElement,
  forwardRef,
  type ComponentType,
  type CSSProperties,
  type FC,
  type JSX,
} from 'react';
import type { DynamicColorSet } from './runtime-colors';

export function vindurFn<TArgs extends unknown[], TReturn extends string>(
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn {
  return () => {
    throw new Error('vindurFn cannot be called at runtime');
  };
}

export type CSSProp = string;

type StyleInterpolationValues =
  | string
  | number
  | (() => StyledComponent<any>)
  | StyledComponent<any>
  | FC<any>
  | (() => FC<any>);

export function css(
  strings: TemplateStringsArray,
  ...values: StyleInterpolationValues[]
): string {
  throw new Error('css cannot be called at runtime');
}

export function createGlobalStyle(
  strings: TemplateStringsArray,
  ...values: StyleInterpolationValues[]
): void {
  throw new Error('createGlobalStyle cannot be called at runtime');
}

export function keyframes(
  strings: TemplateStringsArray,
  ...values: StyleInterpolationValues[]
): string {
  throw new Error('keyframes cannot be called at runtime');
}

export function layer(_layerName: string): string {
  throw new Error('layer cannot be called at runtime');
}

interface VindurClassNameBasedAttributes {
  css?: CSSProp;
  cx?: Record<string, unknown>;
}

export interface VindurAttributes extends VindurClassNameBasedAttributes {
  dynamicColor?: DynamicColorSet;
}

type IntrinsicElementType = keyof JSX.IntrinsicElements;

type StyledComponentProps<Tag extends IntrinsicElementType> =
  JSX.IntrinsicElements[Tag] & VindurAttributes;

type ValidExtraProps = Record<string, string | boolean>;

type StyledComponent<
  Tag extends IntrinsicElementType,
  ExtraProps extends ValidExtraProps = {},
> = FC<StyledComponentProps<Tag> & ExtraProps> & {
  withComponent<NewTag extends keyof JSX.IntrinsicElements>(
    tag: NewTag,
  ): FC<JSX.IntrinsicElements[NewTag] & VindurAttributes>;

  withComponent<C extends ComponentType<any>>(component: C): C;
};

type StyledFunction<Tag extends IntrinsicElementType> = {
  <T extends ValidExtraProps = {}>(
    strings: TemplateStringsArray,
    ...values: StyleInterpolationValues[]
  ): StyledComponent<Tag, T>;

  (
    strings: TemplateStringsArray,
    ...values: StyleInterpolationValues[]
  ): StyledComponent<Tag>;

  attrs<A extends Record<string, any>>(attrs: A): StyledFunction<Tag>;
};

type StyledTags = {
  [Key in keyof JSX.IntrinsicElements]: StyledFunction<Key>;
};

type StyledFnReturn<T extends {}> = {
  <S extends ValidExtraProps = {}>(
    strings: TemplateStringsArray,
    ...values: StyleInterpolationValues[]
  ): FC<T & S>;
  (strings: TemplateStringsArray, ...values: StyleInterpolationValues[]): FC<T>;
};

type StyledFn = <T extends {}>(
  component: ComponentType<T>,
) => keyof VindurAttributes extends keyof T ? StyledFnReturn<T>
: 'className' | 'style' extends keyof T ? StyledFnReturn<T & VindurAttributes>
: 'className' extends keyof T ?
  StyledFnReturn<T & VindurClassNameBasedAttributes>
: never;

interface Styled extends StyledTags, StyledFn {}

export const styled: Styled = new Proxy(
  {},
  {
    get: (target, prop) => {
      throw new Error(`styled cannot be called at runtime`);
    },
  },
) as any;

export function _vSC(
  tagOrComponent: string | ComponentType<any>,
  className: string,
  attrs?: Record<string, string | number | boolean> | null,
): ComponentType<any> {
  // Runtime helper for exported styled components

  const Component = forwardRef<any, any>((props, ref) => {
    const { className: userClassName, ...rest } = props;
    const finalClassName =
      userClassName ? `${className} ${userClassName}` : className;

    // Merge attrs with user props, giving user props precedence
    const finalProps = attrs ? { ...attrs, ...rest } : rest;

    return createElement(tagOrComponent, {
      ...finalProps,
      className: finalClassName,
      ref,
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    Component.displayName = `Styled(${
      typeof tagOrComponent === 'string' ? tagOrComponent : (
        tagOrComponent.displayName || tagOrComponent.name || 'Component'
      )
    })`;
  }

  return Component;
}

export function _vCWM(
  modifiers: Array<[string, string]>,
  baseClassName: string,
  elementType: string | ComponentType<any>,
  attrs?: Record<string, string | number | boolean> | null,
): ComponentType<any> {
  // Runtime helper for styled components with style flags

  // Precompute modifier map once per component instance
  const modifierMap = new Map<string, string>();
  for (const [propName, hashedClassName] of modifiers) {
    modifierMap.set(propName, hashedClassName);
  }
  const modifierEntries = Array.from(modifierMap.entries());

  const Component = forwardRef<any, any>((props, ref) => {
    const { className: userClassName, ...otherProps } = props;

    // Separate style flag props from other props
    const styleProps: Record<string, boolean | string> = {};
    const finalProps: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(otherProps)) {
      if (modifierMap.has(key)) {
        // Accept both boolean and string values for style props
        if (typeof value === 'boolean' || typeof value === 'string') {
          styleProps[key] = value;
        } else {
          // If type doesn't match expected, treat as regular prop
          finalProps[key] = value;
        }
      } else {
        finalProps[key] = value;
      }
    }

    // Build className with modifiers
    let finalClassName = baseClassName;

    // Add modifier classes for active props
    for (const [propName, hashedClassName] of modifierEntries) {
      const propValue = styleProps[propName];

      if (propValue === true) {
        // Boolean prop: add the hashed class name
        finalClassName += ` ${hashedClassName}`;
      } else if (typeof propValue === 'string') {
        // String prop: add the hashed class name with value suffix
        finalClassName += ` ${hashedClassName}-${propValue}`;
      }
    }

    // Add user className if provided
    if (userClassName) {
      finalClassName += ` ${userClassName}`;
    }

    // Merge attrs with finalProps, giving finalProps precedence
    const propsWithAttrs = attrs ? { ...attrs, ...finalProps } : finalProps;

    return createElement(elementType, {
      ...propsWithAttrs,
      className: finalClassName,
      ref,
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    Component.displayName = `StyledWithModifiers(${
      typeof elementType === 'string' ? elementType : (
        elementType.displayName || elementType.name || 'Component'
      )
    })`;
  }

  return Component;
}

export { createStaticThemeColors, createDynamicCssColor } from './runtime-colors';
export type { StaticColor, DynamicCssColor, DynamicColorSet } from './runtime-colors';

// Runtime color utilities are exported from './runtime-colors'

/**
 * Utility for conditionally joining classNames together.
 * Check {@link https://github.com/JedWatson/classnames} for api reference
 */
export function stableId(): string {
  throw new Error('stableId cannot be called at runtime');
}

export function createClassName(id?: string): {
  selector: string;
  value: string;
} {
  if (id) {
    return { selector: `.${id}`, value: id };
  }
  throw new Error('createClassName cannot be called at runtime');
}

export function cx(
  ...args: (string | false | undefined | null | Record<string, unknown>)[]
) {
  const classNames = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    if (typeof arg === 'string' || typeof arg === 'number') {
      classNames.push(arg);
    } else if (typeof arg === 'object') {
      for (let i2 = 0, keys = Object.keys(arg); i2 < keys.length; i2++) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- we know for 100% that the key is there
        if (arg[keys[i2]!]) {
          classNames.push(keys[i2]);
        }
      }
    }
  }

  return classNames.join(' ');
}

/**
 * Merge classNames from spread props with vindur-generated classNames
 */
export function mergeClassNames(
  spreadProps: (Record<string, unknown> | string)[],
  vindurClassName: string,
): string {
  let finalClassName = '';

  // Extract className from spread props
  for (const prop of spreadProps) {
    if (typeof prop === 'string') {
      finalClassName = prop;
    } else if (typeof prop === 'object' && 'className' in prop) {
      const className = prop.className;
      if (typeof className === 'string') {
        finalClassName = className;
      }
    }
  }

  if (finalClassName) return `${finalClassName} ${vindurClassName}`;

  return vindurClassName;
}

/**
 * Merge styles from spread props
 */
export function mergeStyles(
  spreadProps: Record<string, unknown>[],
): Record<string, unknown> {
  const mergedStyle: Record<string, unknown> = {};

  for (const prop of spreadProps) {
    if (typeof prop === 'object' && 'style' in prop) {
      const style = prop.style;
      if (style && typeof style === 'object') {
        Object.assign(mergedStyle, style);
      }
    }
  }

  return mergedStyle;
}
