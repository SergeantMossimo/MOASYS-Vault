/** @type {import("prettier").Config} */
module.exports = {
  // ── Semicolons ───────────────────────────────────────────────────────
  // Whether to add semicolons at the end of statements.
  // false = no semicolons (ASI — Automatic Semicolon Insertion handles it)
  // true  = always add semicolons
  semi: false,

  // ── Quotes ───────────────────────────────────────────────────────────
  // Use single quotes instead of double quotes for strings.
  // true  = 'hello'
  // false = "hello"
  singleQuote: true,

  // ── Trailing commas ──────────────────────────────────────────────────
  // Add trailing commas where valid in ES5 (objects, arrays, etc.).
  // "es5"  = trailing commas in objects and arrays, not function params
  // "all"  = trailing commas everywhere including function parameters
  // "none" = no trailing commas
  trailingComma: 'es5',

  // ── Line length ──────────────────────────────────────────────────────
  // The column width Prettier tries to wrap lines at.
  // Not a hard limit — Prettier will exceed it if breaking would make
  // the code less readable (e.g. a long string or import path).
  printWidth: 100,

  // ── Indentation ──────────────────────────────────────────────────────
  // Number of spaces per indentation level.
  tabWidth: 2,

  // Use spaces instead of tabs.
  // true  = spaces
  // false = tabs
  useTabs: false,

  // ── Arrow functions ──────────────────────────────────────────────────
  // Whether to include parentheses around single arrow function parameters.
  // "avoid" = x => x       (omit parens when there's only one parameter)
  // "always" = (x) => x   (always include parens)
  arrowParens: 'avoid',
}