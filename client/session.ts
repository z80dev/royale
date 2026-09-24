// Per-tab session id sent with every `join` so the server can resume the same seat/player after a dropped socket.
// Stored in sessionStorage: survives reloads and reconnects, but two tabs are two players.
//
// Browsers COPY sessionStorage when a tab is duplicated (or opened via window.open), and two live tabs sharing an id
// would steal the seat from each other forever (each reconnect kicks the other). So the owning tab holds a lock in
// localStorage (shared by all tabs, read synchronously): a heartbeat timestamp, removed on `pagehide`. A reload
// releases the lock before the new page loads and keeps the id; a duplicate finds a live lock and mints a new id.

const STORAGE_KEY = 'lr.sid';
const LOCK_PREFIX = 'lr.sid.lock.';
const HEARTBEAT_MS = 5_000;
// Generous: hidden tabs get their timers throttled hard. Only matters for tabs that died without `pagehide`.
const LOCK_STALE_MS = 75_000;

function freshId(): string {
  // getRandomValues works in insecure contexts too (plain-http LAN IPs), unlike crypto.randomUUID.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function lockIsLive(sid: string): boolean {
  const stamp = Number(localStorage.getItem(LOCK_PREFIX + sid));
  return Number.isFinite(stamp) && stamp > 0 && Date.now() - stamp < LOCK_STALE_MS;
}

/** This tab's session id (stable across reloads, unique per live tab). Call once per page. */
export function claimSessionId(): string {
  try {
    let sid = sessionStorage.getItem(STORAGE_KEY) ?? '';
    if (!/^[0-9a-f]{32}$/.test(sid) || lockIsLive(sid)) sid = freshId();
    sessionStorage.setItem(STORAGE_KEY, sid);
    const lockKey = LOCK_PREFIX + sid;
    const hold = (): void => localStorage.setItem(lockKey, String(Date.now()));
    hold();
    setInterval(hold, HEARTBEAT_MS);
    addEventListener('pagehide', () => localStorage.removeItem(lockKey));
    addEventListener('pageshow', hold); // back/forward-cache restore
    return sid;
  } catch {
    // Storage disabled: a page-lifetime id still covers socket reconnects.
    return freshId();
  }
}
