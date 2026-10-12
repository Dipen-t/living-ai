import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { workspace } from './code-evolution.mjs';

const id = process.argv[2];
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id ?? ''))
  throw new Error('Usage: pnpm evolve:preview <draft-id>');
const directory = path.join(workspace, 'artifacts/code-evolution', id);
const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
if (manifest.state !== 'ready_for_code_review')
  throw new Error('Only a checked draft can be previewed.');
const html = await readFile(path.join(directory, 'preview.html'));
createServer((request, response) => {
  if (request.method !== 'GET' || request.url !== '/') {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy':
      "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(html);
}).listen(5190, '127.0.0.1', () =>
  console.log(`Generated draft preview: http://127.0.0.1:5190/\nDraft: ${id}`),
);
