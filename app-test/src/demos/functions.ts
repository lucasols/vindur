import { vindurFn } from 'vindur';

// Spacing utility function using vindurFn
export const spacing = vindurFn(
  (multiplier: number) => `
  margin: ${multiplier * 8}px;
`,
);

// Color box utility function using vindurFn
export const colorBox = vindurFn(
  (color: string, size: number) => `
  width: ${size}px;
  height: ${size}px;
  background-color: ${color};
  border-radius: 4px;
  display: inline-block;
`,
);

// Button variant utilities using vindurFn
export const primaryButton = vindurFn(
  () => `
  background: #667eea;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  transition: opacity 0.2s;
  
  &:hover {
    opacity: 0.8;
  }
`,
);

export const secondaryButton = vindurFn(
  () => `
  background: #4ecdc4;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  transition: opacity 0.2s;
  
  &:hover {
    opacity: 0.8;
  }
`,
);

export const dangerButton = vindurFn(
  () => `
  background: #ff6b6b;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  transition: opacity 0.2s;
  
  &:hover {
    opacity: 0.8;
  }
`,
);
