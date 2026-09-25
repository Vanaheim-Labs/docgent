import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
// Execute actual route code; inject only I/O boundaries (no live credentials).
export function load(file, boundaries = {}) {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  }});
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(
    (id) => id in boundaries ? boundaries[id] : require(id), module, module.exports);
  return module.exports;
}
