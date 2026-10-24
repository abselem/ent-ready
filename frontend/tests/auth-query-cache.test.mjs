import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import { clearAuthQueries, registerAuthQueryClient } from "../src/lib/auth-query-cache.ts";

test("logout removes fresh private results from every mounted cache", () => {
  const clients = [new QueryClient(), new QueryClient()];
  const unregister = clients.map(registerAuthQueryClient);
  try {
    for (const client of clients) client.setQueryData(["me-full"], { phone: "private" });
    clearAuthQueries();
    for (const client of clients) assert.equal(client.getQueryData(["me-full"]), undefined);
  } finally {
    unregister.forEach((dispose) => dispose());
  }
});

test("a request completing after logout cannot refill either user's cache", async () => {
  const oldClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const unregister = registerAuthQueryClient(oldClient);
  let finish;
  const pending = oldClient.fetchQuery({
    queryKey: ["me-full"],
    queryFn: () => new Promise((resolve) => { finish = resolve; }),
  }).catch(() => undefined);

  clearAuthQueries();
  const newClient = new QueryClient();
  newClient.setQueryData(["me-full"], { user: "B" });
  finish({ user: "A", phone: "private" });
  await pending;
  assert.equal(oldClient.getQueryData(["me-full"]), undefined);
  assert.deepEqual(newClient.getQueryData(["me-full"]), { user: "B" });
  unregister();
  newClient.clear();
});
