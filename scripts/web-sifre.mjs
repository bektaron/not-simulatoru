#!/usr/bin/env node
/**
 * Web yayını şifresini kurar / değiştirir — bilgisayarın kendi terminalinde çalışır (şifre gizli sorulur).
 *
 *   node scripts/web-sifre.mjs              # şifre iki kez gizli sorulur
 *   node scripts/web-sifre.mjs --rastgele   # geçici şifre üretir → web-sifre.local.txt (git dışı)
 *
 * Şifre iki kez sorulur, hiçbir yere yazılmaz. Yeni rastgele tuzla PBKDF2 anahtarı türetilir ve yalnız
 * anahtar web-anahtar.local.json'a yazılır (git dışı). Ardından kayıtlar yeni anahtarla yeniden şifrelenip
 * yayınlanır (web-yayin.mjs --force). Şifre değişince iPad'ler eski anahtarı kendiliğinden bırakır ve yeni
 * şifreyi sorar.
 */
import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KDF_ITER, deriveKeyHex, randomHex } from '../docs/crypto.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const KEY_FILE = path.join(ROOT, 'web-anahtar.local.json');
const PW_FILE = path.join(ROOT, 'web-sifre.local.txt');
const MIN_LEN = 8;

function askHidden(prompt) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) throw new Error('Bu betik bir terminalde çalıştırılmalı (şifre gizli sorulur).');
  return new Promise((resolve) => {
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    let buf = '';
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') {
          stdin.removeListener('data', onData);
          stdin.setRawMode(false);
          stdin.pause();
          stdout.write('\n');
          resolve(buf);
          return;
        }
        if (c === '\u0003') { stdin.setRawMode(false); stdout.write('\n'); process.exit(130); }
        if (c === '\u0008' || c === '\u007f') { if (buf) { buf = [...buf].slice(0, -1).join(''); stdout.write('\b \b'); } continue; }
        if (c < ' ') continue;
        buf += c;
        stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

/** iPad'de kolay yazılan rastgele şifre: 5-5, karışan harfler yok (l·o·0·1) — 32^10 = 2^50 olasılık. */
export function randomPassword() {
  const ABC = 'abcdefghijkmnpqrstuvwxyz23456789';
  const pick = () => {
    const b = new Uint8Array(1);
    do { globalThis.crypto.getRandomValues(b); } while (b[0] >= 256 - (256 % ABC.length)); // eşit dağılım
    return ABC[b[0] % ABC.length];
  };
  const grp = () => Array.from({ length: 5 }, pick).join('');
  return `${grp()}-${grp()}`;
}

async function main() {
  let p1;
  if (process.argv.includes('--rastgele')) {
    // geçici şifre: üretilir ve git dışı web-sifre.local.txt'ye yazılır (ekrana basılmaz); sonra elle değiştirilebilir
    p1 = randomPassword();
    try { execFileSync('git', ['check-ignore', '-q', PW_FILE], { cwd: ROOT }); } catch {
      console.error('web-sifre.local.txt git dışı görünmüyor — .gitignore denetlenmeli. Hiçbir şey değişmedi.');
      process.exit(1);
    }
    writeFileSync(PW_FILE, `${p1}\n`, { encoding: 'utf8', mode: 0o600 });
    console.log('Geçici şifre üretildi: web-sifre.local.txt (git dışı).');
  } else {
    console.log('Web şifresi (öğrenciler iPad\'de bu şifreyi girecek). En az %d karakter.', MIN_LEN);
    p1 = await askHidden('Yeni şifre: ');
    if ([...p1].length < MIN_LEN) { console.error(`Şifre çok kısa (en az ${MIN_LEN}). Hiçbir şey değişmedi.`); process.exit(1); }
    const p2 = await askHidden('Tekrar:     ');
    if (p1 !== p2) { console.error('İki giriş aynı değil. Hiçbir şey değişmedi.'); process.exit(1); }
    rmSync(PW_FILE, { force: true }); // elle kurulan şifre hiçbir yere yazılmaz; eski geçici şifre dosyası kalmasın
  }
  const salt = randomHex(16);
  console.log('Anahtar türetiliyor…');
  const key = await deriveKeyHex(p1, salt, KDF_ITER);
  writeFileSync(KEY_FILE, `${JSON.stringify({ v: 1, salt, iter: KDF_ITER, key, createdAt: new Date().toISOString() }, null, 1)}\n`, { encoding: 'utf8', mode: 0o600 });
  try { execFileSync('git', ['check-ignore', '-q', KEY_FILE], { cwd: ROOT }); } catch {
    console.error('UYARI: web-anahtar.local.json git dışı görünmüyor — .gitignore denetlenmeli. Yayın yapılmadı.');
    process.exit(1);
  }
  console.log('Anahtar yazıldı (web-anahtar.local.json, git dışı; şifrenin kendisi saklanmadı).');
  console.log('Kayıtlar yeni anahtarla yayınlanıyor…');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'web-yayin.mjs'), '--force'], { cwd: ROOT, stdio: 'inherit' });
  // özel bağlantı da yeni anahtarla yenilenir (eski bağlantı artık geçmez)
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'web-baglanti.mjs')], { cwd: ROOT, stdio: 'inherit' });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
