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
  return colors as unknown as {
    [K in keyof C]: StaticColor<C[K]>;
  };
}
