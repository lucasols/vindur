import {
  createElement,
  forwardRef,
  type ComponentType,
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
  dynamicColor?: DynamicColorSet | DynamicColorSet[];
}

// A non-object `cx` stays the native attribute, eg. `<Dot cx="50" />` on a styled circle
type WithNativeCx<Props extends { cx?: unknown }> = Omit<Props, 'cx'>
  & Omit<VindurAttributes, 'cx'> & {
    cx?: Props['cx'] | NonNullable<VindurAttributes['cx']>;
  };

type IntrinsicElementType = keyof JSX.IntrinsicElements;

// The compiler only keeps a native, non-object `cx` on these elements
type NativeCxTag = 'circle' | 'ellipse' | 'radialGradient';

type StyledComponentProps<Tag extends IntrinsicElementType> =
  Tag extends NativeCxTag ? WithNativeCx<JSX.IntrinsicElements[Tag]>
  : 'cx' extends keyof JSX.IntrinsicElements[Tag] ?
    Omit<JSX.IntrinsicElements[Tag], 'cx'> & VindurAttributes
  : JSX.IntrinsicElements[Tag] & VindurAttributes;

type ValidExtraProps = Record<string, string | boolean>;

type StyledComponent<
  Tag extends IntrinsicElementType,
  ExtraProps extends ValidExtraProps = {},
> = FC<StyledComponentProps<Tag> & ExtraProps> & {
  withComponent<NewTag extends keyof JSX.IntrinsicElements>(
    tag: NewTag,
  ): FC<StyledComponentProps<NewTag>>;

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

// Vindur's attributes replace a custom component's own props of the same name
type WithVindurComponentAttributes<
  Props,
  Attributes extends VindurClassNameBasedAttributes,
> =
  Props extends unknown ?
    [Extract<keyof Props, keyof Attributes>] extends [never] ?
      Props & Attributes
    : Omit<Props, keyof Attributes> & Attributes
  : never;

// A required `cx` prop can't be passed, `cx` is always vindur's on styled components
type StyledComponentFnReturn<
  Props extends {},
  Attributes extends VindurClassNameBasedAttributes,
> =
  'cx' extends keyof Props ?
    {} extends Pick<Props, 'cx'> ?
      StyledFnReturn<WithVindurComponentAttributes<Props, Attributes>>
    : never
  : StyledFnReturn<WithVindurComponentAttributes<Props, Attributes>>;

type StyledFn = <T extends {}>(
  component: ComponentType<T>,
) => keyof VindurAttributes extends keyof T ? StyledFnReturn<T>
: 'className' | 'style' extends keyof T ?
  StyledComponentFnReturn<T, VindurAttributes>
: 'className' extends keyof T ?
  StyledComponentFnReturn<T, VindurClassNameBasedAttributes>
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

type StyledAttrs = Record<string, string | number | boolean>;

// The attrs className is always added, so a className passed to the component, or
// compiled from its css or cx prop, doesn't drop it
function splitAttrsClassName(
  className: string,
  attrs: StyledAttrs | null | undefined,
): [string, StyledAttrs | null] {
  if (!attrs) return [className, null];
  const { className: attrsClassName, ...defaultProps } = attrs;
  return [
    attrsClassName ? `${className} ${attrsClassName}` : className,
    defaultProps,
  ];
}

export function _vSC(
  tagOrComponent: string | ComponentType<any>,
  className: string,
  attrs?: StyledAttrs | null,
): ComponentType<any> {
  // Runtime helper for exported styled components

  const [ownClassName, defaultProps] = splitAttrsClassName(className, attrs);
  // A styled DOM element takes a compiled `css` prop as a class name, a styled
  // custom component forwards it to the wrapped component
  const appliesCss = typeof tagOrComponent === 'string';

  const Component = forwardRef<any, any>((props, ref) => {
    // Merge attrs with user props, giving user props precedence
    const {
      className: userClassName,
      css: cssProp,
      ...finalProps
    } = defaultProps ? { ...defaultProps, ...props } : props;

    let finalClassName = ownClassName;
    if (appliesCss) {
      if (cssProp) finalClassName += ` ${cssProp}`;
    } else if (cssProp !== undefined) {
      finalProps.css = cssProp;
    }
    if (userClassName) finalClassName += ` ${userClassName}`;

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
  attrs?: StyledAttrs | null,
): ComponentType<any> {
  // Runtime helper for styled components with style flags

  const [ownClassName, defaultProps] = splitAttrsClassName(
    baseClassName,
    attrs,
  );
  const appliesCss = typeof elementType === 'string';

  // Precompute modifier map once per component instance
  const modifierMap = new Map<string, string>();
  for (const [propName, hashedClassName] of modifiers) {
    modifierMap.set(propName, hashedClassName);
  }
  const modifierEntries = Array.from(modifierMap.entries());

  const Component = forwardRef<any, any>((props, ref) => {
    // Merge attrs with user props first, so attrs can set default style flags
    const {
      className: userClassName,
      css: cssProp,
      ...otherProps
    } = defaultProps ? { ...defaultProps, ...props } : props;

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
    let finalClassName = ownClassName;

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

    // Add the class name of a compiled `css` prop, see `_vSC`
    if (appliesCss) {
      if (cssProp) finalClassName += ` ${cssProp}`;
    } else if (cssProp !== undefined) {
      finalProps.css = cssProp;
    }

    // Add user className if provided
    if (userClassName) {
      finalClassName += ` ${userClassName}`;
    }

    return createElement(elementType, {
      ...finalProps,
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

export {
  createDynamicCssColor,
  createStaticThemeColors,
} from './runtime-colors';
export type {
  DynamicColorSet,
  DynamicCssColor,
  StaticColor,
} from './runtime-colors';

// Runtime color utilities are exported from './runtime-colors'

export function stableId(): string {
  throw new Error('stableId cannot be called at runtime');
}

export type CssVar = {
  /** The custom property name, e.g. `--v1a2b3c-1` */
  readonly name: `--${string}`;
  /** The `var()` reference, e.g. `var(--v1a2b3c-1)` */
  readonly var: string;
};

export function createCssVar(): CssVar {
  throw new Error('createCssVar cannot be called at runtime');
}

export function createClassName(): {
  selector: string;
  value: string;
} {
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
 *
 * Inputs are spread props and explicit `className` values in source order. Like
 * JSX, the last input that sets `className` wins, even when it's nullish
 */
export function mergeClassNames(
  spreadProps: (Record<string, unknown> | string | null | undefined)[],
  vindurClassName: string,
): string {
  let finalClassName = '';

  // Extract className from spread props, a later className key overrides earlier ones like in JSX
  for (const prop of spreadProps) {
    if (typeof prop === 'string') {
      finalClassName = prop;
    } else if (
      prop
      && typeof prop === 'object'
      // JSX spreads only copy own enumerable properties
      && Object.prototype.propertyIsEnumerable.call(prop, 'className')
    ) {
      const className = prop.className;
      finalClassName = typeof className === 'string' ? className : '';
    }
  }

  if (!finalClassName) return vindurClassName;
  if (!vindurClassName) return finalClassName;

  return `${finalClassName} ${vindurClassName}`;
}

/**
 * Resolve the style from spread props placed after an explicit `style`, a later style key
 * overrides earlier ones like in JSX
 */
export function mergeStyles(
  spreadProps: (Record<string, unknown> | null | undefined)[],
  baseStyle: object | undefined = undefined,
): object | undefined {
  let finalStyle = baseStyle;

  for (const prop of spreadProps) {
    if (
      prop
      && typeof prop === 'object'
      // JSX spreads only copy own enumerable properties
      && Object.prototype.propertyIsEnumerable.call(prop, 'style')
    ) {
      const style = prop.style;
      finalStyle =
        typeof style === 'object' && style !== null ? style : undefined;
    }
  }

  return finalStyle;
}
