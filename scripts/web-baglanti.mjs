#!/usr/bin/env node
/**
 * Özel bağlantı (şifresiz giriş): …/#k=<anahtar>. Açan cihaz şifre yazmadan notları görür ve anahtarı saklar.
 *
 *   node scripts/web-baglanti.mjs          # anahtar varsa onu kullanır, yoksa rastgele yeni anahtar üretip yayınlar
 *   node scripts/web-baglanti.mjs --yeni   # yeni rastgele anahtar: eski bağlantılar ve şifre geçersizleşir
 *
 * Bağlantı web-baglanti.local.txt'ye yazılır (git dışı) — ekrana basılmaz. Anahtar web-anahtar.local.json'da
 * (git dışı). Şifreyle kurulmuş anahtar da bağlantıya çevrilebilir (aynı anahtar). Bağlantı = şifre: yalnız
 * görmesi gerekenlere, özelden iletilir. `#` sonrası sunucuya hiç gitmez.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KDF_ITER, randomHex } from '../docs/crypto.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const KEY_FILE = path.join(ROOT, 'web-anahtar.local.json');
const LINK_FILE = path.join(ROOT, 'web-baglanti.local.txt');

/** origin (https://github.com/<kullanıcı>/<depo>.git) → https://<kullanıcı>.github.io/<depo>/ */
export function pagesUrl(remote) {
  const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(String(remote || '').trim());
  return m ? `https://${m[1].toLowerCase()}.github.io/${m[2]}/` : null;
}

function main() {
  const fresh = process.argv.includes('--yeni');
  for (const f of [KEY_FILE, LINK_FILE]) {
    try { execFileSync('git', ['check-ignore', '-q', f], { cwd: ROOT }); } catch {
      console.error(`${path.basename(f)} git dışı görünmüyor — .gitignore denetlenmeli. Hiçbir şey yazılmadı.`);
      process.exit(1);
    }
  }
  let key = null;
  try { key = JSON.parse(readFileSync(KEY_FILE, 'utf8')); } catch { key = null; }
  let made = false;
  if (fresh || !key || !key.key || !key.salt) {
    key = { v: 1, salt: randomHex(16), iter: KDF_ITER, key: randomHex(32), mode: 'baglanti', createdAt: new Date().toISOString() };
    writeFileSync(KEY_FILE, `${JSON.stringify(key, null, 1)}\n`, { encoding: 'utf8', mode: 0o600 });
    made = true;
  }
  let remote = '';
  try { remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8' }); } catch { /* uzak yok */ }
  const base = pagesUrl(remote);
  if (!base) { console.error('GitHub uzak deposu bulunamadı (git remote origin).'); process.exit(1); }
  writeFileSync(LINK_FILE, `${base}#k=${key.key}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(`Bağlantı yazıldı: web-baglanti.local.txt (${made ? 'yeni anahtar' : 'mevcut anahtar'}).`);
  if (made || !existsSync(path.join(ROOT, 'docs', 'web', 'a.enc.json'))) {
    console.log('Kayıtlar bu anahtarla yayınlanıyor…');
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'web-yayin.mjs'), '--force'], { cwd: ROOT, stdio: 'inherit' });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
