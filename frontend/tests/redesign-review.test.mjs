import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AnswerWriteQueue, remainingSeconds, scorePercent } from "../src/lib/test-attempt-state.ts";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

for (const firstOutcome of ["resolve", "reject"]) {
  test(`rapid answer changes preserve latest choice after old write ${firstOutcome}`, async () => {
    const first = deferred();
    const last = deferred();
    const writes = [];
    const published = [];
    const queue = new AnswerWriteQueue((question, option) => {
      writes.push([question, option]);
      return writes.length === 1 ? first.promise : last.promise;
    }, (state) => published.push(state));
    queue.choose(7, 11);
    await tick();
    queue.choose(7, 12);
    queue.choose(7, 13);
    assert.deepEqual(writes, [[7, 11]], "one in-flight write per question");
    first[firstOutcome](new Error("unknown old outcome"));
    await tick();
    assert.deepEqual(writes, [[7, 11], [7, 13]], "intermediate choice coalesced");
    assert.equal(queue.state(7).status, "saving");
    assert.ok(!published.some((state) => state.optionId === 13 && state.status === "saved"));
    last.resolve();
    assert.equal(await queue.flush(), true);
    assert.equal(queue.state(7).optionId, 13);
    assert.equal(queue.state(7).status, "saved");
  });
}

test("failed latest write remains unconfirmed until explicit retry, without parallel retry", async () => {
  let calls = 0;
  const retry = deferred();
  const queue = new AnswerWriteQueue(() => ++calls === 1 ? Promise.reject(new Error("offline")) : retry.promise);
  queue.choose(1, 9);
  assert.equal(await queue.flush(), false);
  assert.equal(queue.state(1).status, "error");
  assert.equal(calls, 1);
  queue.retry(1);
  queue.retry(1);
  await tick();
  assert.equal(calls, 2);
  retry.resolve();
  assert.equal(await queue.flush(), true);
});

test("flush barrier waits for all questions before finish can proceed", async () => {
  const pending = [deferred(), deferred()];
  const queue = new AnswerWriteQueue((question) => pending[question - 1].promise);
  queue.choose(1, 10);
  queue.choose(2, 20);
  let finished = false;
  const barrier = queue.flush().then((saved) => { finished = saved; });
  pending[0].resolve();
  await tick();
  assert.equal(finished, false);
  pending[1].resolve();
  await barrier;
  assert.equal(finished, true);
});

test("expiry freezes queued choices and retries while settling an in-flight write", async () => {
  const first = deferred();
  const writes = [];
  const queue = new AnswerWriteQueue((question, option) => { writes.push([question, option]); return first.promise; });
  queue.choose(1, 10);
  await tick();
  queue.choose(1, 11);
  queue.freeze();
  queue.choose(2, 20);
  queue.retry(1);
  first.resolve();
  assert.equal(await queue.flush(), false, "newer selected choice was not confirmed");
  assert.deepEqual(writes, [[1, 10]], "no late answer sent after expiry");
  assert.equal(queue.state(2), undefined);
});

test("bounded settle returns despite a stalled write and dispose prevents late notifications", async () => {
  const stalled = deferred();
  const notifications = [];
  const queue = new AnswerWriteQueue(() => stalled.promise, (state) => notifications.push(state));
  queue.choose(1, 10);
  await tick();
  assert.equal(await queue.settleWithin(10), false);
  queue.dispose();
  const count = notifications.length;
  stalled.resolve();
  await queue.flush();
  assert.equal(notifications.length, count);
});

test("timer uses absolute time, supports background jumps, and clamps expired time", () => {
  assert.equal(remainingSeconds(null, 1000), null);
  assert.equal(remainingSeconds(61000, 1000), 60);
  assert.equal(remainingSeconds(61000, 30001), 31);
  assert.equal(remainingSeconds(61000, 61000), 0);
  assert.equal(remainingSeconds(61000, 99000), 0);
});

test("weighted score percentage does not invent zero or divide invalid maximum", () => {
  assert.equal(scorePercent(7, 10), 70);
  assert.equal(scorePercent(1, 3), 33);
  for (const pair of [[0, 0], [2, null], [null, 10], [1, -1], [Infinity, 1], [1, NaN]]) {
    assert.equal(scorePercent(...pair), null);
  }
});

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const themes = [...css.matchAll(/:root\s*\{([^}]+)\}/g)].map((match) =>
  Object.fromEntries([...match[1].matchAll(/--app-([\w-]+):\s*(#[\da-f]{6})/gi)].map((token) => [token[1], token[2]])));
function luminance(hex) {
  const values = hex.slice(1).match(/../g).map((channel) => parseInt(channel, 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("both shipped themes meet readable text and identifiable control contrast", () => {
  assert.equal(themes.length, 2, "light and dark token sets must both exist");
  for (const [index, theme] of themes.entries()) {
    for (const [foreground, background] of [
      ["foreground", "card"], ["muted-foreground", "card"],
      ["foreground", "background"], ["muted-foreground", "background"],
      ["primary-foreground", "primary"], ["primary", "accent"],
      ["success", "success-surface"], ["destructive", "destructive-surface"],
    ]) {
      assert.ok(contrast(theme[foreground], theme[background]) >= 4.5,
        `theme ${index}: ${foreground}/${background} must reach 4.5:1`);
    }
    assert.ok(contrast(theme["control-border"], theme.card) >= 3,
      `theme ${index}: control border must reach 3:1 on card`);
  }
});
