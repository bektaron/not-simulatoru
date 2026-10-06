#!/usr/bin/env node
/**
 * Web yayını: data/a.json · b.json → şifreli docs/web/a.enc.json · b.enc.json → commit (post-commit kancası
 * GitHub'a iter, GitHub Pages yayını yenilenir). MyTaskBar her başarılı Pronote yenilemesinden sonra çağırır.
 *
 *   node scripts/web-yayin.mjs            # yalnız gerekiyorsa
 *   node scripts/web-yayin.mjs --force    # her durumda yeniden şifrele (şifre değişince)
 *   node scripts/web-yayin.mjs --no-commit
 *
 * Gerekiyorsa = not içeriği değişti (updatedAt dışında) · anahtar değişti · web dosyası yok · son yayın
 * 20 saatten eski (sayfadaki "Son güncelleme" bayatlamasın). Anahtar yoksa (web-sifre.mjs çalışmamış)
 * hiçbir şey yapmaz. Commit yalnız docs/web/ dosyalarını alır; başka hazırlanmış değişikliğe dokunmaz.
 * Commit mesajında isim yok. Durum: .web-yayin.local.json (git dışı).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encryptText } from '../docs/crypto.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const REPUBLISH_HOURS = 20;
const STUDENTS = ['a', 'b'];

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/** Not içeriğinin parmak izi: updatedAt hariç (her Pronote yenilemesinde değişir, notlar değişmeden). */
export function fingerprint(data) {
  const { updatedAt, ...rest } = data || {};
  void updatedAt;
  return createHash('sha256').update(JSON.stringify(rest)).digest('hex');
}

/**
 * Hangi öğrenci yeniden yayınlanmalı? Saf; dosya yazmaz.
 * inputs: { a: {text, data} | null, ... } · state: { a: {fp, salt, at} } · webExists: { a: bool }
 */
export function plan({ inputs, state = {}, key, webExists = {}, now = Date.now(), force = false }) {
  const out = [];
  for (const s of STUDENTS) {
    const inp = inputs[s];
    if (!inp) continue;
    const st = state[s];
    const fp = fingerprint(inp.data);
    const old = !st || !Date.parse(st.at) || now - Date.parse(st.at) > REPUBLISH_HOURS * 3600000;
    const why = force ? 'zorla' : !webExists[s] ? 'web dosyası yok' : !st || st.salt !== key.salt ? 'anahtar' : st.fp !== fp ? 'notlar değişti' : old ? 'tazeleme' : null;
    if (why) out.push({ student: s, fp, why });
  }
  return out;
}

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

async function commitWithRetry(files, message) {
  for (let i = 0; i < 5; i++) {
    try {
      git(['add', '--', ...files]);
      // yalnız bu dosyalar (pathspec = --only): başka hazırlanmış iş commit'e karışmaz
      const r = spawnSync('git', ['commit', '-q', '-m', message, '--', ...files], { cwd: ROOT, encoding: 'utf8' });
      if (r.status === 0) {
        // git kanca çıktısını stderr'e yönlendirir: post-commit'in "web: itildi / İTİLEMEDİ" satırı
        const hook = String(r.stderr || '').split('\n').filter((l) => /^web: /.test(l.trim())).join(' ').trim();
        return { ok: true, hook };
      }
      throw Object.assign(new Error('commit'), { stderr: r.stderr, stdout: r.stdout });
    } catch (e) {
      const err = String((e.stderr || '') + (e.stdout || ''));
      if (/nothing to commit|no changes added/i.test(err)) return { ok: true, hook: 'değişiklik yok' };
      if (!/index\.lock/.test(err) || i === 4) return { ok: false, err: err.trim().split('\n').slice(-2).join(' ') };
      await new Promise((r) => setTimeout(r, 2000)); // başka bir git işlemi sürüyor
    }
  }
  return { ok: false, err: 'git kilidi' };
}

async function main() {
  const force = process.argv.includes('--force');
  const noCommit = process.argv.includes('--no-commit');
  const key = readJson(path.join(ROOT, 'web-anahtar.local.json'));
  if (!key || !key.key || !key.salt) { console.log('web: şifre kurulmamış (node scripts/web-sifre.mjs) — yayın atlandı'); return; }
  const statePath = path.join(ROOT, '.web-yayin.local.json');
  const state = readJson(statePath) || {};
  const webDir = path.join(ROOT, 'docs', 'web');
  const inputs = {}; const webExists = {};
  for (const s of STUDENTS) {
    const p = path.join(ROOT, 'data', `${s}.json`);
    if (existsSync(p)) {
      const text = readFileSync(p, 'utf8');
      try { inputs[s] = { text, data: JSON.parse(text) }; } catch { console.log(`web: data/${s}.json okunamadı — atlandı`); }
    }
    webExists[s] = existsSync(path.join(webDir, `${s}.enc.json`));
  }
  const todo = plan({ inputs, state, key, webExists, force });
  if (!todo.length) { console.log('web: değişiklik yok'); return; }
  mkdirSync(webDir, { recursive: true });
  const files = [];
  for (const t of todo) {
    const env = await encryptText(inputs[t.student].text, { keyHex: key.key, saltHex: key.salt, iter: key.iter });
    const rel = `docs/web/${t.student}.enc.json`;
    writeFileSync(path.join(ROOT, rel), `${JSON.stringify(env)}\n`, 'utf8');
    files.push(rel);
  }
  const label = todo.map((t) => `${t.student.toUpperCase()} (${t.why})`).join(', ');
  if (!noCommit) {
    const r = await commitWithRetry(files, `Veri: şifreli kayıt güncellendi — ${todo.map((t) => t.student.toUpperCase()).join(', ')}`);
    if (!r.ok) { console.log(`web: ${label} şifrelendi ama commit edilemedi: ${r.err}`); return; }
    if (r.hook) console.log(r.hook);
  }
  const at = new Date().toISOString();
  for (const t of todo) state[t.student] = { fp: t.fp, salt: key.salt, at };
  writeFileSync(statePath, `${JSON.stringify(state, null, 1)}\n`, 'utf8');
  console.log(`web: ${label} yayınlandı${noCommit ? ' (commit yok)' : ''}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.log(`web: hata — ${e.message || e}`); process.exit(1); });
}
