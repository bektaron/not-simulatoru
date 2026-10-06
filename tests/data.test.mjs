import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDataClient, Mode, isStale, isLocalPath } from '../docs/data.js';
import { validate, validateNotes, assertSupported, checkAgainstConfig } from '../docs/validate.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const schema = read('../docs/schema/notes.schema.json');
const cfgA = read('../docs/config/bac-2027.json');
const cfgB = read('../docs/config/seconde-2026.json');
const exA = read('../docs/examples/a.example.json');
const exB = read('../docs/examples/b.example.json');

const NOW = Date.parse('2026-10-03T12:00:00Z');

function fakeFetch(queue) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error('kuyruk boş: ' + url);
    if (next.throw) throw new TypeError('Failed to fetch');
    return {
      status: next.status,
      ok: next.status >= 200 && next.status < 300,
      text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body)),
    };
  };
  fn.calls = calls;
  return fn;
}

const validateData = (student, data) => validateNotes(data, student === 'A' ? cfgA : cfgB, schema).errors;

function client(queue) {
  const fetch = fakeFetch(queue);
  const c = createDataClient({ fetch, now: () => NOW, validateData, localBase: '../data/', demoBase: 'examples/' });
  return { c, fetch };
}

test('şema: desteklenen anahtarlar, örnekler geçerli, bozuk veri yakalanır', () => {
  assertSupported(schema);
  assert.equal(validateNotes(exA, cfgA, schema).valid, true);
  assert.equal(validateNotes(exB, cfgB, schema).valid, true);
  const bad = { ...exA, grades: [{ date: '2026-13-40', subjectId: 'Yok!', note: 125 }], extra: 1 };
  const r = validate(schema, bad);
  assert.equal(r.valid, false);
  const kws = r.errors.map((e) => e.keyword);
  assert.ok(kws.includes('format'));
  assert.ok(kws.includes('pattern'));
  assert.ok(kws.includes('maximum'));
  assert.ok(kws.includes('additionalProperties'));
  assert.ok(validate(schema, { ...exA, updatedAt: 'dün' }).errors.some((e) => e.path === '/updatedAt'));
  assert.ok(validate(schema, { ...exA, grades: [{ date: '2026-09-01', subjectId: 'spe1', note: null }] }).valid);
});

test('config çapraz kontrol: bilinmeyen ders, B\'de locked, katsayı uyuşmazlığı, not > baraj', () => {
  const e1 = checkAgainstConfig({ ...exA, grades: [{ date: '2026-09-01', subjectId: 'bilinmeyen', note: 10 }] }, cfgA);
  assert.ok(e1.some((e) => e.path === '/grades/0/subjectId'));
  const e2 = checkAgainstConfig({ ...exB, locked: [{ id: 'fr', note: 12 }] }, cfgB);
  assert.ok(e2.some((e) => e.path === '/locked'));
  const e3 = checkAgainstConfig({ ...exA, locked: [{ id: 'fr_e', note: 12, coef: 4 }] }, cfgA);
  assert.ok(e3.some((e) => e.path === '/locked/0/coef'));
  const e4 = checkAgainstConfig({ ...exA, grades: [{ date: '2026-09-01', subjectId: 'spe1', note: 9, outOf: 5 }] }, cfgA);
  assert.ok(e4.some((e) => e.path === '/grades/0/note'));
  const e5 = checkAgainstConfig({ ...exA, scenarios: { kotu: { fr_e: 10 } } }, cfgA);
  assert.ok(e5.some((e) => e.path === '/scenarios/kotu/fr_e'));
  assert.deepEqual(checkAgainstConfig(exA, cfgA), []);
});

test('pronoteOverall: şema kabul eder; dönem config dışında ya da değer 20 üstü reddedilir', () => {
  assert.deepEqual(validateNotes(exB, cfgB, schema).errors, []);                 // örnek veri artık taşıyor
  assert.ok(validateNotes({ ...exB, pronoteOverall: { period: 1, value: 21 } }, cfgB, schema).errors.length > 0);
  assert.ok(validateNotes({ ...exB, pronoteOverall: { value: 12 } }, cfgB, schema).errors.length > 0);
  const two = { ...cfgA, periods: [{ index: 1 }, { index: 2 }] };              // iki dönemli config (semestre)
  const e = checkAgainstConfig({ ...exA, pronoteOverall: { period: 3, value: 12 } }, two);
  assert.ok(e.some((x) => x.path === '/pronoteOverall/period'));
});

test('pinned: şema kabul eder; bilinmeyen ve kilitli ders reddedilir', () => {
  assert.deepEqual(validateNotes({ ...exA, pinned: ['spe1'] }, cfgA, schema).errors, []);
  assert.ok(validateNotes({ ...exA, pinned: ['Spe 1'] }, cfgA, schema).errors.length > 0); // kimlik deseni
  const e = checkAgainstConfig({ ...exA, pinned: ['yok', 'fr_e', 'spe2'] }, cfgA);
  assert.deepEqual(e.map((x) => x.path), ['/pinned/0', '/pinned/1']);
});

test('yardımcılar: isStale, isLocalPath', () => {
  assert.equal(isStale('2026-09-25T12:00:00Z', NOW), true);  // 8 gün
  assert.equal(isStale('2026-09-27T12:00:00Z', NOW), false); // 6 gün
  assert.equal(isStale('garbage', NOW), true);
  assert.equal(isLocalPath('../data/'), true);
  assert.equal(isLocalPath('examples/a.example.json'), true);
  assert.equal(isLocalPath('https://api.github.com/x'), false);
  assert.equal(isLocalPath('//evil.example/x'), false);
  assert.equal(isLocalPath('file:///c/x'), false);
  assert.throws(() => createDataClient({ fetch: () => {}, localBase: 'https://x.example/' }));
});

test('yerel kayıt var → LOCAL; yalnız ../data/a.json istenir', async () => {
  const { c, fetch } = client([{ status: 200, body: { ...exA, updatedAt: '2026-10-03T09:00:00+03:00' } }]);
  const r = await c.load('A');
  assert.equal(r.mode, Mode.LOCAL);
  assert.equal(r.stale, false);
  assert.equal(r.data.student, 'A');
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].url, '../data/a.json');
  assert.equal(fetch.calls[0].init.method, 'GET');
});

test('7 günden eski kayıt → stale', async () => {
  const { c } = client([{ status: 200, body: { ...exB, updatedAt: '2026-09-20T09:00:00+03:00' } }]);
  const r = await c.load('B');
  assert.equal(r.mode, Mode.LOCAL);
  assert.equal(r.stale, true);
});

test('kayıt yok (404) → MISSING; örnek veriye kendiliğinden düşmez, başka istek yapılmaz', async () => {
  const { c, fetch } = client([{ status: 404 }]);
  const r = await c.load('A');
  assert.equal(r.mode, Mode.MISSING);
  assert.equal(r.data, null);
  assert.equal(fetch.calls.length, 1);
});

test('bozuk kayıt → INVALID_DATA; JSON değilse de INVALID_DATA', async () => {
  const { c } = client([{ status: 200, body: { hello: 1 } }, { status: 200, body: '{bozuk' }]);
  const r1 = await c.load('A');
  assert.equal(r1.mode, Mode.INVALID_DATA);
  assert.ok(r1.errors.length > 0);
  const r2 = await c.load('A');
  assert.equal(r2.mode, Mode.INVALID_DATA);
});

test('sunucu yok / 500 → ERROR', async () => {
  const { c } = client([{ throw: true }, { status: 500 }]);
  assert.equal((await c.load('A')).mode, Mode.ERROR);
  assert.equal((await c.load('A')).mode, Mode.ERROR);
});

test('örnek veri yalnız loadDemo ile → DEMO', async () => {
  const { c, fetch } = client([{ status: 200, body: exA }]);
  const r = await c.loadDemo('A');
  assert.equal(r.mode, Mode.DEMO);
  assert.equal(fetch.calls[0].url, 'examples/a.example.json');
  assert.equal(r.stale, false);
});

test('hiçbir istek dış adrese gitmez', async () => {
  const { c, fetch } = client([{ status: 404 }, { status: 200, body: exB }, { status: 200, body: exB }]);
  await c.load('A'); await c.load('B'); await c.loadDemo('B');
  for (const call of fetch.calls) assert.equal(isLocalPath(call.url), true, call.url);
});
