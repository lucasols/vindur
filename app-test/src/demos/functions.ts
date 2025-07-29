import { vindurFn } from 'vindur';

// Spacing utility function using vindurFn
export const spacing = vindurFn((multiplier: number) => `
  margin: ${multiplier * 8}px;
`);

// Color box utility function using vindurFn
export const colorBox = vindurFn((color: string, size: number) => `
  width: ${size}px;
  height: ${size}px;
  background-color: ${color};
  border-radius: 4px;
  display: inline-block;
`);

// Button variant utility using vindurFn
export const buttonVariant = vindurFn((variant: 'primary' | 'secondary' | 'danger') => {
  const variants = {
    primary: '#667eea',
    secondary: '#4ecdc4', 
    danger: '#ff6b6b'
  };
  
  return `
    background: ${variants[variant]};
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
    transition: opacity 0.2s;
    
    &:hover {
      opacity: 0.8;
    }
  `;
});