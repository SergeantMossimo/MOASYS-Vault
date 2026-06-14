/** @type {import("prettier").Config} */
// MOASYS-Vault Prettier config. Defaults match modern Node.js / TypeScript
// codebases — single quotes, no semicolons, 100-char lines.
module.exports = {
  semi: false,
  singleQuote: true,
  trailingComma: 'es5',
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  arrowParens: 'avoid',
}
