// Lints the desktop app and the Chrome extension next to it. `npm run lint` runs
// ESLint from the repository root with --config, since ESLint skips files outside
// the folder it runs in and the extension is not inside app/.
const path = require("path");
const js = require("@eslint/js");
const globals = require("globals");

const ROOT = path.join(__dirname, "..");

const rules = {
  ...js.configs.recommended.rules,
  // An empty catch means "ignore this failure" all through Downy, like a missing file.
  "no-empty": ["error", { allowEmptyCatch: true }],
  "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
  eqeqeq: ["error", "always", { null: "ignore" }],
  "no-var": "error",
  "prefer-const": ["error", { destructuring: "all" }],
  "no-implied-eval": "error",
  "no-new-func": "error",
  // Downy reads optional files with `let x = []; try { x = read() } catch {}`, and in the
  // places where the catch returns, the first value is never read. That is harmless.
  "no-useless-assignment": "off",
};

// Each entry is a mistake Downy shipped before. The message names the fix, and `home`
// is the one file that may do what the entry forbids.
const restricted = [
  {
    home: "app/src/main/dev.js",
    selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name=/^DOWNY_/], MemberExpression[object.object.name='process'][object.property.name='env'][property.value=/^DOWNY_/]",
    message: "Read DOWNY_* variables with testVar() from src/main/dev.js. It ignores the testing ones in an installed build.",
  },
  {
    home: "app/src/main/guard.js",
    selector: "MemberExpression[property.name='ipcMain'], MemberExpression[object.name='ipcMain'], Property[key.name='ipcMain']",
    message: "Register IPC with handle() or listen() from src/main/guard.js. They drop calls that don't come from Downy's own pages.",
  },
  {
    home: "app/src/main/tools.js",
    selector: "CallExpression[arguments.0.value='yt-dlp'][callee.name='find'], CallExpression[arguments.0.value='yt-dlp'][callee.property.name='find']",
    message: "Start yt-dlp with the command from ytdlpCommand() in src/main/tools.js. It adds --ignore-config and puts the URL after --.",
  },
];
const restrict = (except) => ["error", ...restricted.filter((r) => r.home !== except).map(({ selector, message }) => ({ selector, message }))];

module.exports = [
  // Paths below are from the repository root. The video folder has its own config.
  { basePath: ROOT, ignores: ["**/node_modules/**", "app/dist/**", "video/**"] },
  {
    basePath: ROOT,
    files: ["app/src/main/**/*.js", "app/test/**/*.js", "app/eslint.config.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "commonjs", globals: globals.node },
    rules,
  },
  { basePath: ROOT, files: ["app/src/main/**/*.js"], rules: { "no-restricted-syntax": restrict() } },
  ...restricted.map(({ home }) => ({ basePath: ROOT, files: [home], rules: { "no-restricted-syntax": restrict(home) } })),
  {
    // Plain scripts that share one window: preload.js gives them `downy`, and icons.js
    // sets icon() and paintIcons() for the others, names.js sets batchName() and motion.js
    // sets roll(), morph(), popIcon() and placePill().
    basePath: ROOT,
    files: ["app/src/renderer/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "script",
      globals: { ...globals.browser, downy: "readonly", icon: "readonly", paintIcons: "readonly", batchName: "readonly", roll: "readonly", morph: "readonly", popIcon: "readonly", placePill: "readonly" },
    },
    // A page's own function may share a name with a newer browser global, like when().
    rules: { ...rules, "no-redeclare": ["error", { builtinGlobals: false }] },
  },
  {
    basePath: ROOT,
    files: ["extension/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "script",
      globals: { ...globals.browser, ...globals.webextensions },
    },
    rules,
  },
];
