/* eslint-disable @typescript-eslint/no-unused-vars */
// todo: implement vite plugin

import { createElement, forwardRef, type ComponentType } from 'react';

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tagOrComponent: string | ComponentType<any>,
  className: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): ComponentType<any> {
  // Runtime helper for exported styled components
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

type Color<D extends string> = {
  var: string;
  defaultHex: D;
  alpha: (alpha: number) => string;
  darken: (amount: number) => string;
  lighten: (amount: number) => string;
  saturate: (amount: number) => string;
  desaturate: (amount: number) => string;
  mix: (color: string, amount: number) => string;
  contrast: {
    var: string;
    alpha: (alpha: number) => string;
  };
};

export function createThemeColors<const C extends Record<string, string>>(
  colors: C,
): {
  colors: {
    [K in keyof C]: Color<C[K]>;
  };
  overrideComponentTheme: (newColors: Partial<C>) => void;
} {
  return {
    colors,
    overrideComponentTheme: (newColors: Partial<C>) => {
      // ...
    },
  };
}

const { colors, overrideComponentTheme } = createThemeColors({
  primary: '#000',
  secondary: '#fff8f8f8',
});

console.log(colors.secondary.var);
