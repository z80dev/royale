// Static file serving for public/ (path-traversal safe).

import { extname, join, normalize, resolve, sep } from 'node:path';

const PUBLIC_DIR = resolve(import.meta.dir, '..', 'public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

function notFound(): Response {
  return new Response('404 — this page got rugged', { status: 404, headers: { 'Content-Type': 'text/plain' } });
}

export async function serveStatic(url: URL): Promise<Response> {
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response('bad request', { status: 400 });
  }
  if (pathname.includes('\0')) return new Response('bad request', { status: 400 });
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const filePath = normalize(join(PUBLIC_DIR, pathname));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + sep)) return notFound();
  const file = Bun.file(filePath);
  if (!(await file.exists())) return notFound();
  const ext = extname(filePath).toLowerCase();
  const headers: Record<string, string> = { 'Content-Type': MIME[ext] ?? 'application/octet-stream' };
  const revalidate = ext === '.html' || ext === '.css' || ext === '.js' || pathname.startsWith('/dist/');
  headers['Cache-Control'] = revalidate ? 'no-cache' : 'public, max-age=300';
  return new Response(file, { headers });
}
