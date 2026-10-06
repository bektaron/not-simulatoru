import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KDF_ITER, decryptEnvelope, deriveKeyHex, encryptText, fromHex, isEnvelope, randomHex, toHex } from '../docs/crypto.js';
import { createDataClient, Mode } from '../docs/data.js';
import { validateNotes } from '../docs/validate.js';
import { dataSource } from '../docs/ui.js';
import { fingerprint, plan, REPUBLISH_HOURS } from '../scripts/web-yayin.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const schema = read('../docs/schema/notes.schema.json');
const cfgA = read('../docs/config/bac-2027.json');
const exA = read('../docs/examples/a.example.json');
const ITER = 1000; // testte hızlı; gerçek yayın KDF_ITER
const SALT = '00112233445566778899aabbccddeeff';
const NOW = Date.parse('2026-10-06T12:00:00Z');

test('crypto: hex gidiş-dönüş · zarf şekli · doğru anahtar çözer, yanlış anahtar hata verir', async () => {
  assert.equal(toHex(fromHex('00ff10')), '00ff10');
  assert.throws(() => fromHex('0g'));
  assert.equal(randomHex(16).length, 32);
  const key = await deriveKeyHex('doğru şifre ü', SALT, ITER);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(await deriveKeyHex('doğru şifre ü', SALT, ITER), key); // belirlenimci
  const env = await encryptText('{"merhaba":"dünya"}', { keyHex: key, saltHex: SALT, iter: ITER });
  assert.ok(isEnvelope(env));
  assert.deepEqual(Object.keys(env).sort(), ['alg', 'ct', 'iter', 'iv', 'kdf', 'salt', 'v']);
  assert.match(env.ct, /^[0-9a-f]+$/); // isim denetimi rastgele eşleşme bulamasın: yalnız hex
  assert.equal(await decryptEnvelope(env, key), '{"merhaba":"dünya"}');
  const wrong = await deriveKeyHex('yanlış', SALT, ITER);
  await assert.rejects(decryptEnvelope(env, wrong));
  await assert.rejects(decryptEnvelope({ ...env, ct: `${env.ct.slice(0, -2)}00` }, key)); // GCM: oynanmış metin
  assert.notEqual((await encryptText('x', { keyHex: key, saltHex: SALT, iter: ITER })).iv, env.iv); // her seferinde yeni IV
  assert.equal(isEnvelope({ ...env, v: 2 }), false);
  assert.equal(KDF_ITER >= 600000, true);
});

function memStore() {
  let slot = null;
  return {
    get: (salt) => (slot && slot.salt === salt ? slot.key : null),
    set(salt, key) { slot = { salt, key }; },
    clear() { slot = null; },
    peek: () => slot,
  };
}

async function webClient(files, keyStore) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (!(url in files)) return { status: 404, ok: false, text: async () => '' };
    return { status: 200, ok: true, text: async () => files[url] };
  };
  const validateData = (s, d) => validateNotes(d, cfgA, schema).errors;
  return { c: createDataClient({ fetch, now: () => NOW, source: 'web', keyStore, validateData }), calls };
}

test('web kaynağı: anahtarsız LOCKED · yanlış şifre false · doğru şifre anahtarı saklar → WEB', async () => {
  const key = await deriveKeyHex('ortak-şifre', SALT, ITER);
  const env = await encryptText(JSON.stringify(exA), { keyHex: key, saltHex: SALT, iter: ITER });
  const store = memStore();
  const { c, calls } = await webClient({ 'web/a.enc.json': JSON.stringify(env) }, store);
  const r1 = await c.load('A');
  assert.equal(r1.mode, Mode.LOCKED);
  assert.equal(r1.data, null);
  assert.deepEqual(calls, ['web/a.enc.json']); // ../data/ hiç istenmez
  assert.equal(await c.unlock('yanlış'), false);
  assert.equal(store.peek(), null);
  assert.equal(await c.unlock('ortak-şifre'), true);
  assert.deepEqual(store.peek(), { salt: SALT, key }); // şifre değil türetilmiş anahtar
  const r2 = await c.load('A');
  assert.equal(r2.mode, Mode.WEB);
  assert.equal(r2.data.displayName, exA.displayName);
  assert.equal(r2.updatedAt, exA.updatedAt);
});

test('web kaynağı: saklı anahtar geçmezse silinir → LOCKED · kayıt yok → MISSING · bozuk zarf → INVALID_DATA', async () => {
  const key = await deriveKeyHex('yeni', SALT, ITER);
  const env = await encryptText(JSON.stringify(exA), { keyHex: key, saltHex: SALT, iter: ITER });
  const store = memStore();
  store.set(SALT, await deriveKeyHex('eski', SALT, ITER));
  const { c } = await webClient({ 'web/a.enc.json': JSON.stringify(env), 'web/b.enc.json': '{"v":1}' }, store);
  const r = await c.load('A');
  assert.equal(r.mode, Mode.LOCKED);
  assert.match(r.message, /değişmiş/);
  assert.equal(store.peek(), null);
  const { c: c2 } = await webClient({}, memStore());
  assert.equal((await c2.load('A')).mode, Mode.MISSING);
  assert.equal((await c.load('B')).mode, Mode.INVALID_DATA);
});

test('kaynak seçimi: localhost/127.0.0.1/file → yerel · başka alan adı → web · ?web zorlar', () => {
  assert.equal(dataSource({ hostname: '127.0.0.1', search: '', protocol: 'http:' }), 'local');
  assert.equal(dataSource({ hostname: 'localhost', search: '', protocol: 'http:' }), 'local');
  assert.equal(dataSource({ hostname: '', search: '', protocol: 'file:' }), 'local');
  assert.equal(dataSource({ hostname: 'bektaron.github.io', search: '', protocol: 'https:' }), 'web');
  assert.equal(dataSource({ hostname: '127.0.0.1', search: '?web', protocol: 'http:' }), 'web');
  assert.equal(dataSource(undefined), 'local');
});

test('yayın planı: notlar değişince · anahtar değişince · dosya yoksa · 20 saatte bir; yalnız updatedAt değişince yayın yok', () => {
  const key = { salt: SALT };
  const data = { ...exA };
  const fp = fingerprint(data);
  assert.equal(fingerprint({ ...data, updatedAt: '2026-10-07T08:00:00+02:00' }), fp);
  assert.notEqual(fingerprint({ ...data, grades: [] }), fp);
  const fresh = new Date(NOW - 3600000).toISOString();
  const state = { a: { fp, salt: SALT, at: fresh } };
  const inputs = { a: { data }, b: null };
  const exists = { a: true, b: false };
  assert.deepEqual(plan({ inputs, state, key, webExists: exists, now: NOW }), []);
  assert.deepEqual(plan({ inputs: { a: { data: { ...data, updatedAt: 'x' } } }, state, key, webExists: exists, now: NOW }), []);
  assert.equal(plan({ inputs: { a: { data: { ...data, grades: [] } } }, state, key, webExists: exists, now: NOW })[0].why, 'notlar değişti');
  assert.equal(plan({ inputs, state, key: { salt: 'ff' }, webExists: exists, now: NOW })[0].why, 'anahtar');
  assert.equal(plan({ inputs, state, key, webExists: { a: false }, now: NOW })[0].why, 'web dosyası yok');
  const old = { a: { fp, salt: SALT, at: new Date(NOW - (REPUBLISH_HOURS + 1) * 3600000).toISOString() } };
  assert.equal(plan({ inputs, state: old, key, webExists: exists, now: NOW })[0].why, 'tazeleme');
  assert.equal(plan({ inputs, state, key, webExists: exists, now: NOW, force: true })[0].why, 'zorla');
});
