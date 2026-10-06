#!/usr/bin/env node
/**
 * Yerel veri dosyasını şemaya ve config'e göre doğrular.
 *   node scripts/validate-data.mjs data/a.json [data/b.json …]
 * Öğrenci (A/B) dosyadaki "student" alanından okunur; config buna göre seçilir.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateNotes, formatErrors } from '../docs/validate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const j = (p) => JSON.parse(readFileSync(p, 'utf8'));
const schema = j(path.join(root, 'docs/schema/notes.schema.json'));
const configs = { A: j(path.join(root, 'docs/config/bac-2027.json')), B: j(path.join(root, 'docs/config/seconde-2026.json')) };

const files = process.argv.slice(2);
if (!files.length) { console.error('Kullanım: node scripts/validate-data.mjs data/a.json [data/b.json]'); process.exit(2); }
let bad = 0;
for (const f of files) {
  let data;
  try { data = j(f); } catch (e) { console.log(`✗ ${f}: JSON okunamadı (${e.message})`); bad++; continue; }
  const cfg = configs[data && data.student];
  if (!cfg) { console.log(`✗ ${f}: "student" A veya B olmalı`); bad++; continue; }
  const r = validateNotes(data, cfg, schema);
  if (r.valid) {
    console.log(`✓ ${f}: geçerli (${data.student}, ${(data.grades || []).length} not, updatedAt ${data.updatedAt})`);
  } else {
    bad++;
    console.log(`✗ ${f}: ${r.errors.length} hata`);
    for (const line of formatErrors(r.errors, 50)) console.log(`   ${line}`);
  }
}
process.exit(bad ? 1 : 0);
