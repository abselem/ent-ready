import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
const axios = createRequire(import.meta.url)("axios");

// Execute actual application modules with isolated storage and controlled HTTP adapters.
// No browser, external API, secrets, or new testing dependencies are required.
function harness() {
  const require = createRequire(import.meta.url);
  const modules = new Map();
  const values = new Map();
  const localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const window = { location: { href: "" } };
  function load(name) {
    if (name === "zustand/middleware") {
      const middleware = require(name);
      return { ...middleware, persist: (initializer, options) => middleware.persist(initializer, {
        ...options, storage: middleware.createJSONStorage(() => localStorage),
      }) };
    }
    if (!name.startsWith("@/")) return require(name);
    if (modules.has(name)) return modules.get(name).exports;
    const filename = fileURLToPath(new URL(`../src/${name.slice(2)}.ts`, import.meta.url));
    const source = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const loadedModule = { exports: {} };
    modules.set(name, loadedModule);
    vm.runInNewContext(`(function(require,module,exports){${source}\n})`, {
      localStorage, window, process, console,
    }, { filename })(load, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  return { store: load("@/store/auth").useAuthStore, ...load("@/lib/api"), window };
}

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const response = (config, data = {}) => ({ data, status: 200, statusText: "OK", headers: {}, config });
const unauthorized = (config) => new axios.AxiosError("Unauthorized", "ERR_BAD_REQUEST", config, {}, {
  ...response(config), status: 401,
});

test("late successful response from account A is cancelled after login as B", async () => {
  const { store, api } = harness();
  store.getState().setTokens("A", "refresh-A");
  const started = deferred();
  const finish = deferred();
  api.defaults.adapter = async (config) => { started.resolve(); await finish.promise; return response(config, { secret: "A" }); };
  const pending = api.get("/users/me");
  await started.promise;
  store.getState().setTokens("B", "refresh-B");
  finish.resolve();
  await assert.rejects(pending, axios.isCancel);
  assert.equal(store.getState().accessToken, "B");
});

test("parallel expired requests share one refresh and both retry with rotated token", async () => {
  const { store, api } = harness();
  store.getState().setTokens("expired", "refresh-A");
  let refreshes = 0;
  const originalPost = axios.post;
  axios.post = async () => { refreshes++; await new Promise((r) => setTimeout(r, 10)); return { data: { access_token: "fresh", refresh_token: "rotated" } }; };
  api.defaults.adapter = async (config) => {
    if (config.headers.Authorization === "Bearer expired") throw unauthorized(config);
    assert.equal(config.headers.Authorization, "Bearer fresh");
    return response(config);
  };
  try {
    await Promise.all([api.get("/one"), api.get("/two")]);
    assert.equal(refreshes, 1);
    assert.equal(store.getState().refreshToken, "rotated");
  } finally { axios.post = originalPost; }
});

for (const outcome of ["resolve", "reject"]) {
  test(`old refresh ${outcome} cannot overwrite or log out the new account`, async () => {
    const { store, api, window } = harness();
    store.getState().setTokens("A", "refresh-A");
    const started = deferred();
    const finish = deferred();
    const originalPost = axios.post;
    axios.post = () => { started.resolve(); return finish.promise; };
    api.defaults.adapter = async (config) => { throw unauthorized(config); };
    try {
      const pending = api.get("/private");
      await started.promise;
      store.getState().logout();
      store.getState().setTokens("B", "refresh-B");
      if (outcome === "resolve") finish.resolve({ data: { access_token: "late-A", refresh_token: "late-refresh-A" } });
      else finish.reject(new Error("Expired old session"));
      await assert.rejects(pending, axios.isCancel);
      assert.equal(store.getState().accessToken, "B");
      assert.equal(store.getState().refreshToken, "refresh-B");
      assert.equal(window.location.href, "");
    } finally { axios.post = originalPost; }
  });
}

test("signOut submits current credentials before clearing local state", async () => {
  const { store, api, signOut } = harness();
  store.getState().setTokens("A", "refresh-A");
  let requests = 0;
  api.defaults.adapter = async (config) => {
    requests++;
    assert.equal(config.url, "/auth/logout");
    assert.equal(config.method, "post");
    assert.equal(config.headers.Authorization, "Bearer A");
    assert.equal(store.getState().accessToken, "A");
    return response(config);
  };
  await signOut();
  assert.equal(requests, 1);
  assert.equal(store.getState().accessToken, null);
  assert.equal(store.getState().refreshToken, null);
});

test("offline signOut still clears local credentials", async () => {
  const { store, api, signOut } = harness();
  store.getState().setTokens("A", "refresh-A");
  api.defaults.adapter = async () => { throw new Error("Offline"); };
  await signOut();
  assert.equal(store.getState().accessToken, null);
  assert.equal(store.getState().refreshToken, null);
});

test("delayed signOut response cannot clear a newly logged-in account", async () => {
  const { store, api, signOut } = harness();
  store.getState().setTokens("A", "refresh-A");
  const started = deferred();
  const finish = deferred();
  api.defaults.adapter = async (config) => { started.resolve(); await finish.promise; return response(config); };
  const pending = signOut();
  await started.promise;
  store.getState().setTokens("B", "refresh-B");
  finish.resolve();
  await pending;
  assert.equal(store.getState().accessToken, "B");
});
