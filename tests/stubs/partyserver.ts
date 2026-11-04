// Test-only stand-in: real partyserver imports `cloudflare:workers`, which Node can't load.
// Broadcasts are a no-op under vitest (no Durable Objects in Node).
export async function getServerByName(): Promise<never> {
  throw new Error('partyserver unavailable in tests');
}
export class Server {}
export async function routePartykitRequest() {
  return null;
}
