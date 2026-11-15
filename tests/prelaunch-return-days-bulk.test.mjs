import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync(new URL('../lib/routes/prelaunch-return-days-bulk.js', import.meta.url), 'utf8');
const diagnostics = readFileSync(new URL('../api/diagnostics.js', import.meta.url), 'utf8');
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

test('return day bulk endpoint is wired to diagnostics', () => {
  assert.match(diagnostics, /'prelaunch-return-days-bulk':prelaunchReturnDaysBulk/);
  assert.ok(vercel.rewrites.some(x => x.source === '/api/prelaunch-return-days-bulk' && x.destination === '/api/diagnostics?action=prelaunch-return-days-bulk'));
});

test('return day bulk operation requires explicit authorization and separate write gate', () => {
  assert.match(route, /req\.headers\?\.authorization !== 'Bearer ' \+ admin/);
  assert.match(route, /ADPS_RETURN_DAYS_WRITE_ENABLED/);
  assert.match(route, /SET_9_DRAFT_RETURNS_TO_7/);
  assert.match(route, /if \(!apply\) return json\(res, 200, \{ ok: true, readOnly: true/);
});

test('return day update fails closed for wrong count, status, existing values or incomplete pagination', () => {
  assert.match(route, /const TARGET_COUNT = 9/);
  assert.match(route, /const RETURN_DAYS = '7'/);
  assert.match(route, /connection\.pageInfo\?\.hasNextPage !== false/);
  assert.match(route, /products\.some\(p => p\.status !== 'DRAFT'\)/);
  assert.match(route, /Existing nonempty return window requires manual review/);
  assert.match(route, /namespace: 'custom', key: 'return_days'/);
  assert.doesNotMatch(route, /productUpdate\s*\(|productPublish\s*\(/);
});
