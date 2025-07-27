/* eslint-disable @typescript-eslint/no-unused-vars */
// todo: implement vite plugin

import type { ComponentType } from 'react';

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
  tagOrComponent: string | ComponentType<unknown>,
  className: string,
): ComponentType<unknown> {
  // ...
}
