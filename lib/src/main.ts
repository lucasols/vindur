/* eslint-disable @typescript-eslint/no-unused-vars -- Unused variables in main.ts are runtime exports that may be used by consumers */
// todo: implement vite plugin

import {
  createElement,
  forwardRef,
  type ComponentType,
  type CSSProperties,
} from 'react';

export function vindurFn<TArgs extends unknown[], TReturn extends string>(
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn {
  console.error('vindurFn cannot be called at runtime');
  return fn;
}

export function css(
  strings: TemplateStringsArray,
  ...values: (string | number)[]
): string {
  console.error('css cannot be called at runtime');
  return '';
}

type StyledFunction = (
  strings: TemplateStringsArray,
  ...values: (string | number)[]
) => ComponentType<unknown>;

// Create a Proxy that handles all DOM element access dynamically
const styledHandler = {
  get: (_: unknown, tag: string): StyledFunction => {
    return (strings: TemplateStringsArray, ...values: (string | number)[]) => {
      console.error('styled cannot be called at runtime');
      return () => null;
    };
  },
};

export const styled = new Proxy({}, styledHandler);

export function styledComponent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic component type requires any for maximum flexibility
  tagOrComponent: string | ComponentType<any>,
  className: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Return type must be flexible for any component props
): ComponentType<any> {
  // Runtime helper for exported styled components
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- forwardRef requires any for generic component forwarding
  const Component = forwardRef<any, any>((props, ref) => {
    const { className: userClassName, ...rest } = props;
    const finalClassName =
      userClassName ? `${className} ${userClassName}` : className;

    if (typeof tagOrComponent === 'string') {
      // Native HTML element
      return createElement(tagOrComponent, {
        ...rest,
        className: finalClassName,
        ref,
      });
    }

    // Custom component
    return createElement(tagOrComponent, {
      ...rest,
      className: finalClassName,
      ref,
    });
  });

  Component.displayName = `Styled(${
    typeof tagOrComponent === 'string' ? tagOrComponent : (
      tagOrComponent.displayName || tagOrComponent.name || 'Component'
    )
  })`;

  return Component;
}

type StaticColor<D extends string> = {
  var: string;
  defaultHex: D;
  alpha: (alpha: number) => string;
  darker: (amount: number) => string;
  lighter: (amount: number) => string;
  contrast: {
    var: string;
    optimal: (options?: { saturation?: number; alpha?: number }) => string;
    alpha: (alpha: number) => string;
  };
};

export function createStaticThemeColors<const C extends Record<string, string>>(
  colors: C,
): {
  [K in keyof C]: StaticColor<C[K]>;
} {
  // At runtime, this function should never be called as it gets replaced during compilation
  // But we need to provide a valid runtime implementation for TypeScript
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Runtime fallback requires type assertion for compile-time transform
  return colors as unknown as {
    [K in keyof C]: StaticColor<C[K]>;
  };
}

type DynamicCssColor = {
  var: string;
  alpha: (alpha: number) => string;
  darker: (amount: number) => string;
  lighter: (amount: number) => string;
  saturatedDarker: (amount: number) => string;
  contrast: {
    var: string;
    optimal: (options?: { saturation?: number; alpha?: number }) => string;
    alpha: (alpha: number) => string;
  };
  setProps: (
    hexColor: string,
    options?: {
      style?: CSSProperties;
      className?: string;
      setColorScheme?: { fallback: 'light' | 'dark' };
    },
  ) => { className: string; style: CSSProperties };
  // Transform-time methods
  set: (color: string | null | false | undefined) => DynamicColorSet;
  _sp: (
    color: string | null | false | undefined,
    mergeWith: {
      className?: string;
      style?: Record<string, unknown>;
    },
  ) => {
    className?: string;
    style?: Record<string, unknown>;
  };
  // selectors to be used in the component that is setting the color
  self: {
    isDark: string;
    isLight: string;
    isDefined: string;
    isNotDefined: string;
    isVeryDark: string;
    isNotVeryDark: string;
    isVeryLight: string;
    isNotVeryLight: string;
  };
  // selectors to be used in children components
  container: {
    isDark: string;
    isLight: string;
    isDefined: string;
    isNotDefined: string;
    isVeryDark: string;
    isNotVeryDark: string;
    isVeryLight: string;
    isNotVeryLight: string;
  };
};

type DynamicColorSet = {
  __color: string | null | false | undefined;
  __dynamicColorId: string;
};

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h: number;
  let s: number;
  const l = (max + min) / 2;

  if (max === min) {
    h = s = 0; // achromatic
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
      default:
        h = 0;
    }
    h /= 6;
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

function isLightColor(hex: string): boolean {
  const { l } = hexToHsl(hex);
  return l > 50;
}

function isDarkColor(hex: string): boolean {
  return !isLightColor(hex);
}

function isVeryDark(hex: string): boolean {
  const { l } = hexToHsl(hex);
  return l < 20;
}

function isVeryLight(hex: string): boolean {
  const { l } = hexToHsl(hex);
  return l > 80;
}

function getContrastColor(hex: string): string {
  return isLightColor(hex) ? '#000000' : '#ffffff';
}

export function createDynamicCssColor(hashId?: string, devMode?: boolean) {
  if (!hashId) {
    throw new Error(
      'createDynamicCssColor() should not be called with an ID parameter. The ID is automatically generated by the compiler.',
    );
  }

  // Map conditions to shorter indices for production
  const selfConditions = [
    'is-dark',
    'is-light',
    'is-defined',
    'is-not-defined',
    'is-very-dark',
    'is-not-very-dark',
    'is-very-light',
    'is-not-very-light',
  ] as const;

  function getClassName(
    type: 'self' | 'container',
    condition: (typeof selfConditions)[number],
  ): string {
    if (devMode) return `${hashId}-${type}-${condition}`;

    const index = selfConditions.indexOf(condition);
    const shortType = type === 'self' ? 's' : 'c';

    return `${hashId}-${shortType}${index}`;
  }

  const color: DynamicCssColor = {
    var: `var(--${hashId})`,
    alpha: (alpha: number) =>
      `color-mix(in srgb, var(--${hashId}) ${alpha * 100}%, transparent)`,
    darker: (amount: number) =>
      `color-mix(in srgb, var(--${hashId}) ${(1 - amount) * 100}%, #000)`,
    lighter: (amount: number) =>
      `color-mix(in srgb, var(--${hashId}) ${(1 - amount) * 100}%, #fff)`,
    saturatedDarker: (amount: number) =>
      `color-mix(in srgb, var(--${hashId}) ${(1 - amount) * 100}%, hsl(from var(--${hashId}) h 100% 20%))`,

    contrast: {
      var: `var(--${hashId}-c)`,
      optimal: (options?: { saturation?: number; alpha?: number }) => {
        if (options?.alpha) {
          return `color-mix(in srgb, var(--${hashId}-c-optimal) ${options.alpha * 100}%, transparent)`;
        }
        return `var(--${hashId}-c-optimal)`;
      },
      alpha: (alpha: number) =>
        `color-mix(in srgb, var(--${hashId}-c) ${alpha * 100}%, transparent)`,
    },

    setProps: (hexColor: string, options = {}) => {
      const colorClasses: string[] = [];

      // Add condition classes based on color properties
      if (isDarkColor(hexColor)) {
        colorClasses.push(getClassName('self', 'is-dark'));
      } else {
        colorClasses.push(getClassName('self', 'is-light'));
      }

      colorClasses.push(getClassName('self', 'is-defined'));

      if (isVeryDark(hexColor)) {
        colorClasses.push(getClassName('self', 'is-very-dark'));
      } else {
        colorClasses.push(getClassName('self', 'is-not-very-dark'));
      }

      if (isVeryLight(hexColor)) {
        colorClasses.push(getClassName('self', 'is-very-light'));
      } else {
        colorClasses.push(getClassName('self', 'is-not-very-light'));
      }

      // Merge with user-provided className
      const userClassName = options.className || '';
      const finalClassName =
        userClassName ?
          `${userClassName} ${colorClasses.join(' ')}`
        : colorClasses.join(' ');

      // Create CSS custom properties
      const contrastColor = getContrastColor(hexColor);
      const colorStyle: CSSProperties = {
        [`--${hashId}`]: hexColor,
        [`--${hashId}-c`]: contrastColor,
        [`--${hashId}-c-optimal`]: contrastColor,
        ...options.style,
      };

      return {
        className: finalClassName,
        style: colorStyle,
      };
    },

    self: {
      isDark: `&.${getClassName('self', 'is-dark')}`,
      isLight: `&.${getClassName('self', 'is-light')}`,
      isDefined: `&.${getClassName('self', 'is-defined')}`,
      isNotDefined: `&.${getClassName('self', 'is-not-defined')}`,
      isVeryDark: `&.${getClassName('self', 'is-very-dark')}`,
      isNotVeryDark: `&.${getClassName('self', 'is-not-very-dark')}`,
      isVeryLight: `&.${getClassName('self', 'is-very-light')}`,
      isNotVeryLight: `&.${getClassName('self', 'is-not-very-light')}`,
    },

    container: {
      isDark: `.${getClassName('container', 'is-dark')} &`,
      isLight: `.${getClassName('container', 'is-light')} &`,
      isDefined: `.${getClassName('container', 'is-defined')} &`,
      isNotDefined: `.${getClassName('container', 'is-not-defined')} &`,
      isVeryDark: `.${getClassName('container', 'is-very-dark')} &`,
      isNotVeryDark: `.${getClassName('container', 'is-not-very-dark')} &`,
      isVeryLight: `.${getClassName('container', 'is-very-light')} &`,
      isNotVeryLight: `.${getClassName('container', 'is-not-very-light')} &`,
    },

    set: (colorValue: string | null | false | undefined) => {
      console.error('color.set() should not be called at runtime');
      return {
        __color: colorValue,
        __dynamicColorId: hashId,
      };
    },

    _sp: (
      colorValue: string | null | false | undefined,
      mergeWith: {
        className?: string;
        style?: Record<string, unknown>;
      },
    ) => {
      console.error('color._sp() should not be called at runtime');
      return mergeWith;
    },
  };

  return color;
}

/**
 * Utility for conditionally joining classNames together.
 * Check {@link https://github.com/JedWatson/classnames} for api reference
 */
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
  const classNames: string[] = [];

  // Extract className from spread props
  for (const prop of spreadProps) {
    if (typeof prop === 'string') {
      classNames.push(prop);
    } else if (typeof prop === 'object' && 'className' in prop) {
      const className = prop.className;
      if (typeof className === 'string') {
        classNames.push(className);
      }
    }
  }

  // Add vindur className
  classNames.push(vindurClassName);

  return classNames.join(' ');
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
