/**
 * Ortak arayüz bileşenleri. Veri metinleri her zaman textContent ile yazılır
 * (kayıttaki string'ler HTML olarak yorumlanmaz).
 */
import * as E from './engine.js';
import { createDataClient, Mode } from './data.js';
import { validateNotes, formatErrors } from './validate.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Küçük DOM kurucu: el('div', {class:'x', onclick: fn}, 'metin', child) */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') throw new Error('innerHTML kullanılmaz');
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const fmt = (n) => (E.isNote(n) ? (Math.round(n * 100) / 100).toFixed(2).replace('.', ',') : '–');
export const fmt1 = (n) => (E.isNote(n) ? (Math.round(n * 10) / 10).toFixed(1).replace('.', ',') : '–');
export const fmtSigned = (n) => (E.isNote(n) ? (n >= 0 ? '+' : '−') + fmt(Math.abs(n)) : '–');

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
export function fmtDate(iso) {
  if (typeof iso !== 'string') return '–';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${+m[3]} ${MONTHS[+m[2] - 1] || m[2]} ${m[1]}`;
}
export function fmtDateTime(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return typeof iso === 'string' ? iso : '–';
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${hh}:${mm}`;
}
export function fmtNote(g) {
  if (!g || !E.isNote(g.note)) return 'Abs';
  const outOf = E.isNote(g.outOf) ? g.outOf : 20;
  const n = String(g.note).replace('.', ',');
  return outOf === 20 ? n : `${n}/${String(outOf).replace('.', ',')}`;
}

/* ------------------------------------------------------------------ */
/* Depolama yardımcıları                                               */
/* ------------------------------------------------------------------ */

function safe(storeName) {
  return {
    get(key) { try { return globalThis[storeName] ? globalThis[storeName].getItem(key) : null; } catch { return null; } },
    set(key, v) { try { if (globalThis[storeName]) { globalThis[storeName].setItem(key, v); return true; } } catch { /* yoksay */ } return false; },
    remove(key) { try { if (globalThis[storeName]) globalThis[storeName].removeItem(key); } catch { /* yoksay */ } },
  };
}
export const localStore = safe('localStorage');
export const sessionStore = safe('sessionStorage');

/** Oturum içi durum (sekmeyle ölür): "Özel" senaryo, geçici notlar, sekme seçimi. */
export function sessionState(key, initial = {}) {
  let cache;
  try { cache = JSON.parse(sessionStore.get(key) || 'null'); } catch { cache = null; }
  if (!cache || typeof cache !== 'object') cache = { ...initial };
  return {
    get: () => cache,
    patch(partial) { cache = { ...cache, ...partial }; sessionStore.set(key, JSON.stringify(cache)); return cache; },
    clear() { cache = { ...initial }; sessionStore.remove(key); },
  };
}

/* ------------------------------------------------------------------ */
/* Tema                                                                */
/* ------------------------------------------------------------------ */

const THEME_KEY = 'ds:v1:theme';
const THEME_LABEL = { auto: 'Tema: otomatik', light: 'Tema: açık', dark: 'Tema: koyu' };
export function initTheme(button) {
  const apply = (t) => {
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    if (button) button.textContent = THEME_LABEL[t] || THEME_LABEL.auto;
  };
  let cur = localStore.get(THEME_KEY) || 'auto';
  apply(cur);
  if (button) {
    button.addEventListener('click', () => {
      cur = cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto';
      if (cur === 'auto') localStore.remove(THEME_KEY); else localStore.set(THEME_KEY, cur);
      apply(cur);
    });
  }
}

/* ------------------------------------------------------------------ */
/* Çıktı (PDF / yazdır)                                                */
/* ------------------------------------------------------------------ */

/**
 * "PDF" düğmesi: window.print(). Tarayıcıda yazdırma penceresi (PDF olarak kaydet); MyTaskBar'ın gömülü penceresinde
 * istek yakalanır ve doğrudan PDF yazılır (mtb/notsimweb.py). Sayfa dosya yazmaz. Hazırlık: kapalı <details> açılır,
 * üste çıktı damgası (başlık · etkin sekme · tarih) — MyTaskBar printToPdf öncesi aynı hazırlığı window.__nsPrintPrep ile çağırır.
 */
export function initPrint(button) {
  const opened = [];
  window.__nsPrintPrep = () => {
    for (const d of document.querySelectorAll('details:not([open])')) { d.open = true; opened.push(d); }
    let st = document.getElementById('printStamp');
    if (!st) {
      st = el('div', { id: 'printStamp', class: 'print-only' });
      const wrap = document.querySelector('.wrap') || document.body;
      wrap.prepend(st);
    }
    const h1 = document.querySelector('h1');
    const tab = document.querySelector('[role=tab][aria-selected="true"]');
    st.textContent = [h1 ? h1.textContent : document.title, tab ? tab.textContent : '', `çıktı ${fmtDateTime(new Date().toISOString())}`]
      .filter(Boolean).join(' · ');
  };
  window.__nsPrintDone = () => { while (opened.length) opened.pop().open = false; };
  window.addEventListener('beforeprint', window.__nsPrintPrep);
  window.addEventListener('afterprint', window.__nsPrintDone);
  if (button) button.addEventListener('click', () => window.print());
}

/* ------------------------------------------------------------------ */
/* Yükleme / istemci                                                   */
/* ------------------------------------------------------------------ */

export async function loadJson(url) {
  const res = await fetch(url, { method: 'GET', cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} yüklenemedi (HTTP ${res.status})`);
  return res.json();
}

/**
 * Kaynak: bilgisayarda (localhost — MyTaskBar penceresi, Not-Simulatoru.bat) yerel data/; başka her yerde
 * (GitHub Pages, iPad) şifreli web/. `?web` adresi yerelde de web kaynağını dener (sınama için).
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
export function dataSource(loc = globalThis.location) {
  if (!loc) return 'local';
  if (new URLSearchParams(loc.search || '').has('web')) return 'web';
  return LOCAL_HOSTS.has(loc.hostname) || loc.protocol === 'file:' ? 'local' : 'web';
}

/**
 * Web anahtarı (şifreden türetilmiş, şifrenin kendisi değil): "hatırla" → localStorage, yoksa sekmelik
 * sessionStorage. Tuz kayıttakiyle eşleşmezse (şifre değişmiş) yok sayılır.
 */
const KEY_SLOT = 'ds:v1:webkey';
export const webKeyStore = {
  get(salt) {
    for (const st of [localStore, sessionStore]) {
      try { const v = JSON.parse(st.get(KEY_SLOT) || 'null'); if (v && v.salt === salt && typeof v.key === 'string') return v.key; } catch { /* yoksay */ }
    }
    return null;
  },
  set(salt, key, { remember = true } = {}) {
    this.clear();
    (remember ? localStore : sessionStore).set(KEY_SLOT, JSON.stringify({ salt, key }));
  },
  clear() { localStore.remove(KEY_SLOT); sessionStore.remove(KEY_SLOT); },
};

/**
 * Özel bağlantı (şifresiz giriş): adres …/#k=<64 hex>. `#` sonrası sunucuya hiç gitmez. Anahtar okunur ve adres
 * çubuğundan silinir (yer imine, geçmişe kalmasın); tutarsa data.js onu cihaza kaydeder.
 */
export function linkKeyFromHash(hash) {
  const m = /(?:^#|&)k=([0-9a-f]{64})(?:&|$)/i.exec(String(hash || ''));
  return m ? m[1].toLowerCase() : null;
}
function takeLinkKey(loc = globalThis.location, hist = globalThis.history) {
  const key = loc ? linkKeyFromHash(loc.hash) : null;
  if (key && hist && hist.replaceState) {
    try { hist.replaceState(null, '', loc.pathname + loc.search); } catch { /* yoksay */ }
  }
  return key;
}

/**
 * Sayfa başlangıcı: config'ler, şema, istemci ve kayıt (yerel ya da şifreli web).
 * configs: { anahtar: url }  — hepsi göreli, yerel dosyalar.
 */
export async function boot({ student, configs = {}, validateWith }) {
  const [schema, ...cfgList] = await Promise.all([
    loadJson('schema/notes.schema.json'),
    ...Object.values(configs).map(loadJson),
  ]);
  const cfg = Object.fromEntries(Object.keys(configs).map((k, i) => [k, cfgList[i]]));
  const pick = (stu) => (validateWith && typeof validateWith === 'object' ? cfg[validateWith[stu]] : cfg[validateWith]) || Object.values(cfg)[0];
  const validateData = (stu, data) => validateNotes(data, pick(stu), schema).errors;
  const client = createDataClient({
    fetch: (...a) => fetch(...a),
    source: dataSource(),
    localBase: '../data/',
    webBase: 'web/',
    demoBase: 'examples/',
    keyStore: webKeyStore,
    linkKey: takeLinkKey(),
    validateData,
  });
  const result = student ? await client.load(student) : null;
  return { schema, configs: cfg, client, result };
}

/* ------------------------------------------------------------------ */
/* Durum bandı                                                         */
/* ------------------------------------------------------------------ */

/** Her sayfanın üstündeki kayıt durumu + "Son güncelleme" bandı. */
export function renderBanner(container, result) {
  container.textContent = '';
  if (!result) return;
  const { mode } = result;
  let cls = 'banner';
  let label = '';
  let text = result.message;
  if (mode === Mode.DEMO) { cls += ' demo'; label = 'Örnek veri'; }
  else if (mode === Mode.LOCAL || mode === Mode.WEB) {
    cls += result.stale ? ' stale' : ' live';
    label = result.stale ? 'Kayıt · eski' : 'Kayıt';
    text = result.stale ? `Kayıt 7 günden eski — ${mode === Mode.WEB ? 'bilgisayardaki MyTaskBar Pronote\'tan yenileyince güncellenir' : 'notlar projede güncellenmeli'}.` : '';
  }
  else if (mode === Mode.LOCKED) { cls += ' cached'; label = 'Şifreli'; }
  else if (mode === Mode.MISSING) { cls += ' cached'; label = 'Kayıt yok'; }
  else { cls += ' error'; label = 'Sorun'; }
  container.className = cls;
  container.setAttribute('role', 'status');
  container.append(el('span', { class: 'label', text: label }));
  if (text) container.append(el('span', { text }));
  if (result.updatedAt) container.append(el('span', { class: 'num', text: `Son güncelleme: ${fmtDateTime(result.updatedAt)}` }));
  if (result.data && result.data.source && mode !== Mode.DEMO) container.append(el('span', { class: 'sub', text: `Kaynak: ${result.data.source}` }));
  if (result.errors && result.errors.length) {
    container.append(el('ul', {}, formatErrors(result.errors).map((l) => el('li', { text: l }))));
  }
}

/* ------------------------------------------------------------------ */
/* Bileşenler                                                          */
/* ------------------------------------------------------------------ */

/** 6–20 eşik göstergesi. update(value) ile dolgu güncellenir. */
export function buildGauge(container, { min = 6, max = 20, mentions }) {
  const pct = (v) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
  const fill = el('div', { class: 'gfill' });
  const ticks = el('div');
  const labels = el('div', { class: 'glabels' });
  for (const m of mentions.filter((x) => x.min > min && x.min <= max && x.level !== 'rattrapage')) {
    const tk = el('div', { class: 'gtick' }); tk.style.left = `${pct(m.min)}%`; ticks.append(tk);
    const sp = el('span', {}, el('b', { text: String(m.min) }), m.short || m.label); sp.style.left = `${pct(m.min)}%`; labels.append(sp);
  }
  container.textContent = '';
  container.className = 'gauge';
  container.setAttribute('aria-hidden', 'true');
  container.append(el('div', { class: 'gtrack' }, fill, ticks), labels);
  return { update(v) { fill.style.width = `${pct(E.isNote(v) ? v : min)}%`; } };
}

/** Mention rozetini yazar. */
export function setPill(node, m) {
  node.textContent = m ? m.label : '–';
  node.className = `pill ${m ? m.tone : 'acc'}`;
}

/**
 * Defter satırı: ad + ipucu, ×katsayı, kaydırıcı, sayı kutusu, "+1 puan", "Puan".
 * onInput(value) her değişimde çağrılır.
 */
export function noteRow({ id, name, hint, coef, value, step = 0.25, min = 0, max = 20, deltaPerPoint, onInput, estimated = false, showCells = true }) {
  const rng = el('input', { type: 'range', id: `r-${id}`, min, max, step, 'aria-label': `${name} notu` });
  const num = el('input', { type: 'number', id: `n-${id}`, min, max, step, 'aria-label': `${name} notu (sayı)`, inputmode: 'decimal' });
  const nameEl = el('div', { class: 'name' }, name, estimated ? el('span', { class: 'tag est', text: 'tahmin' }) : null, el('small', { text: hint || '' }));
  const c1 = el('div', { class: 'cell c1' });
  const c2 = el('div', { class: 'cell c2' });
  const row = el('div', { class: 'row', dataset: { subject: id } },
    nameEl,
    el('div', { class: 'coef' }, '×', el('b', { text: String(coef) })),
    el('div', { class: 'rng' }, rng),
    el('div', { class: 'val' }, num),
    c1, c2);
  const set = (v) => { rng.value = String(v); num.value = String(v); };
  const commit = (v) => {
    if (!Number.isFinite(v)) return;
    const c = E.clamp(v, min, max);
    set(c);
    update(c);
    if (onInput) onInput(c);
  };
  function update(v, { totalCoef } = {}) {
    if (!showCells) { c1.textContent = ''; c2.textContent = ''; return; }
    const d = E.isNote(totalCoef) ? coef / totalCoef : deltaPerPoint;
    c1.textContent = ''; c1.append(`+${fmt(d)}`, el('small', { text: '+1 puan' }));
    c2.textContent = ''; c2.append(fmt1(v * coef), el('small', { text: 'puan' }));
  }
  rng.addEventListener('input', () => commit(parseFloat(rng.value)));
  num.addEventListener('input', () => { const v = parseFloat(num.value); if (Number.isFinite(v)) commit(v); });
  num.addEventListener('change', () => { if (!Number.isFinite(parseFloat(num.value))) set(rng.value); });
  set(value);
  update(value);
  return { el: row, set, update, get value() { return parseFloat(rng.value); } };
}

/** Basılı/bırakılmış düğme grubu. */
export function segButtons(container, items, activeId, onSelect) {
  container.textContent = '';
  const buttons = items.map((it) => el('button', {
    type: 'button', class: 'btn', 'aria-pressed': String(it.id === activeId), dataset: { id: it.id }, text: it.label,
    onclick: () => { set(it.id); if (onSelect) onSelect(it.id); },
  }));
  buttons.forEach((b) => container.append(b));
  function set(id) { buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === id))); }
  return { set, clear: () => set(null) };
}

/** Sekmeler (role=tablist). */
export function initTabs(root, { active, onChange } = {}) {
  const tabs = $$('[role=tab]', root);
  const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')));
  function select(id) {
    tabs.forEach((t, i) => {
      const on = t.id === id;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (panels[i]) panels[i].hidden = !on;
    });
    if (onChange) onChange(id);
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t.id));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const visible = tabs.filter((x) => !x.hidden);
      const j = visible.indexOf(t);
      const next = visible[(j + (e.key === 'ArrowRight' ? 1 : visible.length - 1)) % visible.length];
      next.focus(); select(next.id); e.preventDefault();
    });
    void i;
  });
  select(active && tabs.some((t) => t.id === active && !t.hidden) ? active : tabs.find((t) => !t.hidden).id);
  return { select };
}

/**
 * Şifre kutusu (web kaydı kilitliyken). onUnlock(password, remember) → true | false; true ise çağıran yeniden çizer.
 * <form> yok (CSP form-action 'none'): Enter ve düğme aynı işi yapar. Şifre hiçbir yere yazılmaz.
 */
export function unlockBox({ onUnlock, message } = {}) {
  const pw = el('input', { type: 'password', id: 'unlockPw', autocomplete: 'current-password', 'aria-label': 'Şifre', enterkeyhint: 'go' });
  const rem = el('input', { type: 'checkbox', id: 'unlockRem', checked: true });
  const btn = el('button', { type: 'button', class: 'btn primary', text: 'Aç' });
  const msg = el('p', { class: 'sub', role: 'status' });
  async function go() {
    if (!pw.value) { pw.focus(); return; }
    btn.disabled = true; msg.className = 'sub'; msg.textContent = 'Açılıyor…';
    const ok = await onUnlock(pw.value, rem.checked);
    if (ok) return;
    btn.disabled = false; msg.className = 'msg bad'; msg.textContent = 'Şifre yanlış.';
    pw.select();
  }
  btn.addEventListener('click', go);
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  return el('div', { class: 'unlock' },
    message ? el('p', { class: 'lead', text: message }) : null,
    el('div', { class: 'unlock-row mt' }, pw, btn),
    el('label', { class: 'check mt', for: 'unlockRem' }, rem, el('span', { text: 'Bu cihazda hatırla' })),
    msg);
}

/** Kayıt yoksa gösterilecek boş durum; kayıt şifreliyse şifre kutusu. */
export function renderEmptyState(container, result, { onDemo, onUnlock } = {}) {
  container.textContent = '';
  if (result && result.mode === Mode.LOCKED && onUnlock) {
    container.append(
      el('h2', { text: 'Notlar şifreli' }),
      unlockBox({ onUnlock, message: result.message }),
      onDemo ? el('div', { class: 'actions mt' }, el('button', { type: 'button', class: 'btn small', text: 'Şifresiz: örnek (uydurma) veriyle dene', onclick: onDemo })) : null,
    );
    setTimeout(() => { const p = document.getElementById('unlockPw'); if (p) p.focus(); }, 0);
    return;
  }
  container.append(
    el('h2', { text: 'Kayıt gösterilemiyor' }),
    el('p', { class: 'lead', text: result ? result.message : 'Bilinmeyen durum.' }),
    el('div', { class: 'actions mt' },
      onDemo ? el('button', { type: 'button', class: 'btn', text: 'Örnek (uydurma) veriyle dene', onclick: onDemo }) : null),
  );
}

export { Mode, E };
