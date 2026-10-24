import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Render actual shared components with artificial props, without a browser or API.
const require = createRequire(import.meta.url);
const cache = new Map();
function load(name) {
  if (!name.startsWith("@/")) return require(name);
  if (cache.has(name)) return cache.get(name).exports;
  const base = fileURLToPath(new URL(`../src/${name.slice(2)}`, import.meta.url));
  const filename = [base + ".tsx", base + ".ts"].find(existsSync);
  assert.ok(filename, `missing component ${name}`);
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  cache.set(name, loaded);
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { console, process, setTimeout, clearTimeout }, { filename })(load, loaded, loaded.exports);
  return loaded.exports;
}
const { AttemptResult } = load("@/components/test/attempt-result");
const { Input } = load("@/components/ui/input");
const { Button } = load("@/components/ui/button");
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
const question = { id: 1, text: "PRIVATE_QUESTION", points: 2, is_correct: false, options: [
  { id: 1, text: "PRIVATE_CORRECT_ANSWER", is_correct: true, chosen: false },
  { id: 2, text: "SELECTED_ANSWER", is_correct: false, chosen: true },
] };

test("locked results never render private questions or answers, even when passed accidentally", () => {
  const html = render(AttemptResult, { data: { score: 3, max_score: 10, can_see_answers: false, questions: [question] } });
  assert.match(html, /Разбор пока недоступен/);
  assert.doesNotMatch(html, /PRIVATE_|SELECTED_ANSWER/);
  assert.match(html, /30% от максимального балла/);
});
test("weighted result uses points language and text labels in addition to colors", () => {
  const html = render(AttemptResult, { data: { score: 8, max_score: 10, can_see_answers: true, questions: [question] } });
  assert.match(html, /80% от максимального балла/);
  assert.doesNotMatch(html, /% правильных/);
  for (const label of ["Неверно", "Ваш ответ", "Правильный ответ"]) assert.ok(html.includes(label));
});
test("unknown or zero maximum never renders fabricated percentage or non-finite values", () => {
  for (const max_score of [0, null]) {
    const html = render(AttemptResult, { data: { score: null, max_score, questions: [] } });
    assert.doesNotMatch(html, /NaN|Infinity|% от максимального/);
  }
});
test("expiry result explains that unconfirmed answers may be excluded", () => {
  const html = render(AttemptResult, { data: { score: 0, max_score: 10, time_expired: true, questions: [] } });
  assert.match(html, /Неподтверждённые ответы могли не войти/);
});
test("input errors are associated with their control and existing descriptions are preserved", () => {
  const html = render(Input, { id: "email", label: "Email", error: "Введите email", "aria-describedby": "email-help" });
  assert.match(html, /for="email"/);
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /aria-describedby="email-help email-error"/);
  assert.match(html, /id="email-error" role="alert"/);
});
test("loading button is disabled and exposes its busy state", () => {
  const html = render(Button, { loading: true, children: "Сохранить" });
  assert.match(html, /disabled=""/);
  assert.match(html, /aria-busy="true"/);
});
