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
const { LessonBlockView } = load("@/components/lesson/block-view");
const { orderedLessonBlocks, lessonStepExcerpt } = load("@/components/lesson/types");
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));

const lessonBlock = (overrides = {}) => ({ id: 1, type: "text", content: "Материал", language: "", caption: "", order_num: 0, ...overrides });

test("lesson steps retain legacy content and escape pasted HTML", () => {
  const html = render(LessonBlockView, { block: lessonBlock({ type: "legacy", content: '<script>alert("x")</script>', caption: "Подпись" }) });
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Подпись/);
});

test("lesson theory renders formulas and code stays literal", () => {
  assert.match(render(LessonBlockView, { block: lessonBlock({ content: "$x^2$" }) }), /katex/);
  const code = render(LessonBlockView, { block: lessonBlock({ type: "code", language: "html", content: '<img src=x onerror="alert(1)">' }) });
  assert.match(code, /&lt;img/);
  assert.doesNotMatch(code, /<img/);
});

test("lesson image rejects executable URLs and keeps a real caption", () => {
  for (const content of ["javascript:alert(1)", "data:image/svg+xml,<svg/>", "//other.example/picture.png"]) {
    assert.doesNotMatch(render(LessonBlockView, { block: lessonBlock({ type: "image", content }) }), /<img/);
  }
  const html = render(LessonBlockView, { block: lessonBlock({ type: "image", content: "https://example.test/image.png", caption: "Рисунок 1" }) });
  assert.match(html, /alt="Рисунок 1"/);
  assert.match(html, /<figcaption/);
});

test("lesson ordering is stable without modifying cached data; excerpts do not redefine captions", () => {
  const blocks = [lessonBlock({ id: 3, order_num: 1 }), lessonBlock({ id: 2, order_num: 0 }), lessonBlock({ id: 1, order_num: 0 })];
  assert.deepEqual(Array.from(orderedLessonBlocks(blocks), block => block.id), [1, 2, 3]);
  assert.deepEqual(blocks.map(block => block.id), [3, 2, 1]);
  assert.equal(lessonStepExcerpt(lessonBlock({ type: "image", content: "https://example.test/a", caption: "  Подпись   рисунка " })), "Подпись рисунка");
});
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
