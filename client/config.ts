// Where the game server lives. Resolution order:
// 1. `?server=wss://…/ws` query param (testing against another backend)
// 2. LR_SERVER_URL baked in at build time (`bun run build:pages` → the public Cloudflare front door)
// 3. same origin (`bun run start` serves the client from the game server itself)

declare const LR_SERVER_URL: string | undefined;

export function serverUrl(): string {
  const override = new URLSearchParams(location.search).get('server');
  if (override) return override;
  if (typeof LR_SERVER_URL === 'string' && LR_SERVER_URL) return LR_SERVER_URL;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}
