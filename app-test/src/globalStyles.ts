import { createGlobalStyle } from 'vindur';

// Global styles
createGlobalStyle`
  body {
    margin: 0;
    padding: 20px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
  }
  
  * {
    box-sizing: border-box;
  }
`;
