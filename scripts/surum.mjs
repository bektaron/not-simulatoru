#!/usr/bin/env node
/**
 * Dosya sürümü (O63): sayfaların yüklediği her betik ve stil adresine ?v=<sürüm> eklenir.
 * GitHub Pages dosyaları 10 dk önbellekte tutar; yayından hemen sonra tarayıcı yeni sayfa betiğini eski
 * ui.js ile birleştirirse modül içe aktarımı kırılır ve sayfa boş kalır. Sürüm değişince adres de değişir,
 * eski ve yeni dosyalar karışmaz.
 *
 * Sürüm = docs/*.js + docs/styles.css içeriğinin SHA-256'sının ilk 10 hanesi (sürüm damgaları çıkarılarak),
 * tek sürüm bütün dosyalarda — bir modül her yerden aynı adresle yüklenir (iki kopya olmaz).
 *
 *   node scripts/surum.mjs          damgala (npm run surum)
 *   node scripts/surum.mjs --check  damga güncel değilse çıkış 1 (pre-commit kancası, test)
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DOCS = fileURLToPath(new URL('../docs/', import.meta.url));

const STAMP = /\?v=[0-9a-f]*/g;
// HTML: <script … src="x.js"> · <link … href="styles.css"> — yalnız yerel, düz dosya adları
const HTML_REF = /((?:src|href)=")([a-z0-9-]+\.(?:js|css))(?:\?v=[0-9a-f]*)?(")/g;
// JS: import … from './x.js' (dinamik import yok)
const JS_REF = /(from\s+'\.\/)([a-z0-9-]+\.js)(?:\?v=[0-9a-f]*)?(')/g;

/** Damgalanacak dosyalar: { name: içerik } (docs/ kökü; alt klasörler veri/config, damgaya girmez). */
export function readDocs(dir = DOCS) {
  const out = {};
  for (const name of readdirSync(dir).sort()) {
    if (/\.(html|js|css)$/.test(name)) out[name] = readFileSync(join(dir, name), 'utf8');
  }
  return out;
}

/** İçerikten sürüm: damgalar çıkarılmış .js ve .css içeriği, ad sırasıyla. */
export function computeVersion(files) {
  const h = createHash('sha256');
  for (const name of Object.keys(files).sort()) {
    if (!/\.(js|css)$/.test(name)) continue;
    h.update(name + '\0' + files[name].replace(STAMP, '') + '\0');
  }
  return h.digest('hex').slice(0, 10);
}

/** Her dosyanın damgalanmış hali. */
export function stamp(files, version = computeVersion(files)) {
  const out = {};
  for (const [name, text] of Object.entries(files)) {
    if (name.endsWith('.html')) out[name] = text.replace(HTML_REF, `$1$2?v=${version}$3`);
    else if (name.endsWith('.js')) out[name] = text.replace(JS_REF, `$1$2?v=${version}$3`);
    else out[name] = text;
  }
  return out;
}

/** Güncel olmayan dosya adları (boş = damgalar güncel). */
export function stale(files) {
  const want = stamp(files);
  return Object.keys(files).filter((n) => want[n] !== files[n]);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const files = readDocs();
  const bad = stale(files);
  const version = computeVersion(files);
  if (process.argv.includes('--check')) {
    if (bad.length) {
      console.error(`Dosya sürümü güncel değil (${bad.join(', ')}) — önce: npm run surum`);
      process.exit(1);
    }
    console.log(`Dosya sürümü güncel: ${version}`);
  } else {
    const want = stamp(files, version);
    for (const n of bad) writeFileSync(join(DOCS, n), want[n]);
    console.log(bad.length ? `Damgalandı ${version}: ${bad.join(', ')}` : `Zaten güncel: ${version}`);
  }
}
