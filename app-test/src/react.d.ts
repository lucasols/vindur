import 'react';
import type { VindurAttributes } from 'vindur';

type CustomProp = { [key in `--${string}`]?: string | number };

declare module 'react' {
  export interface CSSProperties extends CustomProp {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface HTMLAttributes<T> extends VindurAttributes {}
}
