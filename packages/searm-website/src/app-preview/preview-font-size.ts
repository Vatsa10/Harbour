// searm-front's rem base is 13px (its index.css); the site root is 16px.
// The product mockups render at the product's size, so searm-ui's rem font
// sizes resolve to absolute px at 13. This is the only font transform — every
// other value is consumed straight from searm-ui's theme.
const PRODUCT_REM_BASE_PX = 13;

export const previewFontSize = (themeRemValue: string): string =>
  `${parseFloat(themeRemValue) * PRODUCT_REM_BASE_PX}px`;
