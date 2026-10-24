import type { QueryClient } from "@tanstack/react-query";

const clients = new Set<QueryClient>();

export function registerAuthQueryClient(client: QueryClient) {
  clients.add(client);
  return () => {
    void client.cancelQueries();
    client.clear();
    clients.delete(client);
  };
}

export function clearAuthQueries() {
  for (const client of clients) {
    void client.cancelQueries();
    client.clear();
  }
}
