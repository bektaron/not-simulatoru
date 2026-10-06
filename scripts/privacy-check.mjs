#!/usr/bin/env node
/**
 * Gizlilik denetimi — repo içinde kişisel veri aramaz, bulursa build'i kırar.
 *
 *   node scripts/privacy-check.mjs            # izlenen + izlenmeyen (ignore dışı) dosyalar
 *   node scripts/privacy-check.mjs --history  # + tüm git geçmişi (git log -p --all)
 *   node scripts/privacy-check.mjs --messages[=<aralık>]  # + commit mesajları (varsayılan HEAD; pre-push kancası
 *                                             itilecek aralığı verir — depo herkese açık, mesajlar da görünür)
 *
 * Yasaklı terimler repoya yazılamaz; şuradan okunur:
 *   - ortam değişkeni PRIVACY_TERMS  (virgül veya | ile ayrılmış)   ← CI'da GitHub secret
 *   - .privacy-terms.local dosyası   (satır başına bir terim, gitignored) ← yerel
 * Terimler diakritik ve büyük/küçük harften bağımsız aranır. Çıktıda terimin
 * kendisi yazılmaz, yalnız sıra numarası.
 *
 * Her zaman çalışan genel denetimler:
 *   - e-posta adresi, okul Pronote sunucu adı deseni, telefon numarası
 *   - "gerçek veri dosyası" dedektörü: schemaVersion + grades taşıyan JSON yalnız
 *     docs/examples/*.example.json içinde ve "example": true ile olabilir
 *   - *.local.* / data/*.local.json izlenen dosya olamaz
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const HISTORY = process.argv.includes('--history');
const MSG_ARG = process.argv.find((a) => a === '--messages' || a.startsWith('--messages='));
const MSG_RANGE = MSG_ARG ? (MSG_ARG.split('=')[1] || 'HEAD') : null;
const SELF = 'scripts/privacy-check.mjs';
const SKIP = new Set([SELF, 'package-lock.json']);

let failures = 0;
const fail = (msg) => { failures++; console.log(`::error::${msg}`); };
const warn = (msg) => console.log(`::warning::${msg}`);

/* --- terimler ----------------------------------------------------- */
export function normalize(s) {
  return s
    .replace(/İ/g, 'i').replace(/I/g, 'i').replace(/ı/g, 'i')
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase();
}
function loadTerms() {
  const out = [];
  const env = process.env.PRIVACY_TERMS || '';
  for (const t of env.split(/[,|\n]/)) if (t.trim()) out.push(t.trim());
  const localFile = path.join(ROOT, '.privacy-terms.local');
  if (existsSync(localFile)) {
    for (const t of readFileSync(localFile, 'utf8').split('\n')) if (t.trim() && !t.startsWith('#')) out.push(t.trim());
  }
  return [...new Set(out.map(normalize))].filter((t) => t.length >= 3);
}
const TERMS = loadTerms();
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* Terim kelime başında aranır: "Ad", "Adın", "Ad'ın" yakalanır; "taşımalı" gibi
   diakritik normalizasyonuyla ortaya çıkan iç eşleşmeler yakalanmaz. */
const TERM_RES = TERMS.map((t) => new RegExp(`(^|[^a-z0-9])${esc(t)}`));
if (TERMS.length === 0) warn('PRIVACY_TERMS tanımlı değil ve .privacy-terms.local yok — isim denetimi atlandı. CI için repo secret ekleyin.');

/* --- genel desenler ------------------------------------------------ */
const GENERIC = [
  { name: 'e-posta adresi', re: /[a-z0-9._%+-]+@(?!example\.(?:com|org|net)\b)[a-z0-9.-]+\.[a-z]{2,}/gi },
  { name: 'okul Pronote sunucu adı', re: /\b[a-z0-9-]+\.index-education\.net\b/gi },
  { name: 'telefon numarası (TR)', re: /(?:\+90|\b0)[\s-]?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g },
  { name: 'telefon numarası (FR)', re: /(?:\+33|\b0)[\s.-]?[1-9](?:[\s.-]?\d{2}){4}\b/g },
];

/* --- dosya listesi ------------------------------------------------- */
function git(cmd) {
  try { return execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; }
}
function listFiles() {
  const tracked = git('ls-files -z').split('\0');
  const untracked = git('ls-files -z --others --exclude-standard').split('\0');
  return [...new Set([...tracked, ...untracked])].filter((f) => f && !SKIP.has(f) && existsSync(path.join(ROOT, f)));
}
function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/* --- metin tarama -------------------------------------------------- */
function scanText(text, where) {
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const norm = normalize(line);
    TERM_RES.forEach((re, k) => {
      if (re.test(norm)) fail(`${where}:${i + 1} — yasaklı terim #${k + 1}`);
    });
    for (const g of GENERIC) {
      g.re.lastIndex = 0;
      if (g.re.test(line)) fail(`${where}:${i + 1} — ${g.name} deseni`);
    }
  });
}

/* --- veri dosyası dedektörü --------------------------------------- */
function checkDataFile(file, text) {
  let obj;
  try { obj = JSON.parse(text); } catch { return; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
  const looksLikeData = 'schemaVersion' in obj && Array.isArray(obj.grades);
  if (!looksLikeData) return;
  const okPath = /^docs\/examples\/[a-z0-9-]+\.example\.json$/.test(file);
  if (!okPath) fail(`${file} — not verisi taşıyan JSON yalnız docs/examples/*.example.json olabilir`);
  if (obj.example !== true) fail(`${file} — not verisi taşıyan JSON "example": true içermeli`);
  if (!/ÖRNEK/i.test(String(obj._comment || ''))) fail(`${file} — "_comment" alanı ÖRNEK ibaresi taşımalı`);
}

/* --- çalıştır ------------------------------------------------------ */
const files = listFiles();
for (const f of files) {
  if (/(^|\/)[^/]*\.local\.[^/]*$/.test(f) || /^data\/.*\.local\.json$/.test(f)) fail(`${f} — yerel (kişisel) dosya izleniyor`);
  const buf = readFileSync(path.join(ROOT, f));
  if (isBinary(buf)) continue;
  const text = buf.toString('utf8');
  scanText(text, f);
  if (f.endsWith('.json')) checkDataFile(f, text);
}

if (HISTORY) {
  const log = git('log --all -p --format=commit:%H');
  if (log) {
    let commit = '?';
    let file = '';
    const lines = log.split('\n');
    lines.forEach((line, i) => {
      if (line.startsWith('commit:')) { commit = line.slice(7, 19); file = ''; return; }
      if (line.startsWith('diff --git ')) { file = line.replace(/^diff --git a\/.* b\//, ''); return; }
      if (SKIP.has(file)) return; // denetim betiğinin kendi geçmişi taranmaz
      const norm = normalize(line);
      TERM_RES.forEach((re, k) => { if (re.test(norm)) fail(`geçmiş ${commit} ${file} (satır ${i + 1}) — yasaklı terim #${k + 1}`); });
      for (const g of GENERIC) { g.re.lastIndex = 0; if (g.re.test(line)) fail(`geçmiş ${commit} (satır ${i + 1}) — ${g.name} deseni`); }
    });
  }
}

let msgCount = 0;
if (MSG_RANGE) {
  if (!/^(HEAD|[0-9a-f]{7,40})(\.\.[0-9a-f]{7,40})?$/i.test(MSG_RANGE)) fail(`--messages aralığı tanınmadı: ${MSG_RANGE}`);
  else {
    const raw = git(`log --format=%h%x00%B%x01 ${MSG_RANGE}`);
    for (const m of raw.split('\x01').filter((x) => x.trim())) {
      const [h, body = ''] = m.replace(/^\s+/, '').split('\x00');
      msgCount++;
      const norm = normalize(body);
      TERM_RES.forEach((re, k) => { if (re.test(norm)) fail(`commit ${h} mesajı — yasaklı terim #${k + 1}`); });
      const plain = body.replace(/[a-z0-9._%+-]*noreply@[a-z0-9.-]+/gi, ''); // Co-Authored-By noreply adresi kişisel değil
      for (const g of GENERIC) { g.re.lastIndex = 0; if (g.re.test(plain)) fail(`commit ${h} mesajı — ${g.name} deseni`); }
    }
  }
}

console.log(`Gizlilik denetimi: ${files.length} dosya${HISTORY ? ' + geçmiş' : ''}${MSG_RANGE ? ` + ${msgCount} commit mesajı` : ''}, ${TERMS.length} terim, ${failures} bulgu.`);
process.exit(failures ? 1 : 0);
