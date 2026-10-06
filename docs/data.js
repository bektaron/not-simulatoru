/**
 * Veri katmanı — yalnız kendi sunulduğu yerden (aynı köken, göreli yol) okur.
 *
 * Simülatör notları kendisi almaz, hiçbir yere bağlanmaz. Notları MyTaskBar Pronote'tan okuyup
 * data/a.json · data/b.json dosyalarına yazar (yerel kaynak). Web yayınında (GitHub Pages) aynı kayıt
 * şifreli durur: docs/web/<a|b>.enc.json (crypto.js); anahtar kullanıcının şifresinden türetilir,
 * keyStore'da (tarayıcı) tutulur. Ağ adresi, token, uzak API yoktur.
 *
 *   createDataClient({ fetch, now, source, localBase, webBase, demoBase, keyStore, validateData })
 *     .load(student)      → Result   (yerel: LOCAL | MISSING · web: WEB | LOCKED | MISSING)
 *     .unlock(password, {remember}) → true | false  (son okunan şifreli kayıtla dener, anahtarı saklar)
 *     .loadDemo(student)  → Result   (yalnız kullanıcı isterse: uydurma örnek)
 *
 *   Result = { student, mode, status, data|null, updatedAt, stale, errors, message }
 */
import { decryptEnvelope, deriveKeyHex, isEnvelope } from './crypto.js';

export const Mode = Object.freeze({
  LOCAL: 'local',               // data/<a|b>.json okundu
  WEB: 'web',                   // web/<a|b>.enc.json okundu ve çözüldü
  LOCKED: 'locked',             // web kaydı var, anahtar yok ya da geçmiyor
  MISSING: 'missing',           // yerel kayıt yok
  INVALID_DATA: 'invalid-data', // kayıt var ama JSON/şema hatalı
  DEMO: 'demo',                 // kullanıcı örnek veriyi açtı
  ERROR: 'error',               // diğer
});

export const STALE_DAYS = 7;

/** updatedAt `days` günden eskiyse (veya okunamıyorsa) true. */
export function isStale(updatedAt, nowMs = Date.now(), days = STALE_DAYS) {
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return true;
  return nowMs - t > days * 86400000;
}

/** Yalnız göreli (aynı köken) yollar kabul edilir; şema/protokol içeren adres reddedilir. */
export function isLocalPath(p) {
  return typeof p === 'string' && p.length > 0 && !/^[a-z][a-z0-9+.-]*:/i.test(p) && !p.startsWith('//');
}

export function safeMessage(mode, { status } = {}) {
  switch (mode) {
    case Mode.LOCAL: return 'Yerel kayıttan okundu.';
    case Mode.WEB: return 'Web kaydından (şifreli) okundu.';
    case Mode.LOCKED: return 'Notlar şifreli. Görmek için şifreyi girin ya da size verilen özel bağlantıyı açın.';
    case Mode.MISSING: return 'Bu öğrenci için kayıt yok (data/ klasöründe dosya bulunamadı). MyTaskBar Pronote\'tan yenileyince burada görünür.';
    case Mode.INVALID_DATA: return 'Kayıt dosyası okunabildi ama şemaya uymuyor. Ayrıntılar aşağıda.';
    case Mode.DEMO: return 'ÖRNEK VERİ — uydurma notlar gösteriliyor; gerçek kayıt değil.';
    default: return `Kayıt okunamadı${status ? ` (HTTP ${status})` : ''}.`;
  }
}

export function createDataClient({
  fetch: fetchFn,
  now = () => Date.now(),
  source = 'local',
  localBase = '../data/',
  webBase = 'web/',
  demoBase = 'examples/',
  keyStore = null,
  linkKey = null, // özel bağlantıdan gelen anahtar (hex) — şifresiz giriş
  validateData = () => [],
} = {}) {
  let linkCheck = null; // Promise<boolean>: bağlantı anahtarı kaydı çözüyor mu
  if (typeof fetchFn !== 'function') throw new Error('fetch gerekli');
  if (![localBase, webBase, demoBase].every(isLocalPath)) throw new Error('Yalnız yerel (göreli) yol kullanılabilir');
  if (source !== 'local' && source !== 'web') throw new Error(`Bilinmeyen kaynak: ${source}`);
  let lastEnvelope = null; // unlock() bununla dener (iki öğrencinin kaydı aynı şifreyle)

  function result(student, mode, extra = {}) {
    const data = extra.data || null;
    const updatedAt = data && typeof data.updatedAt === 'string' ? data.updatedAt : null;
    return {
      student,
      mode,
      status: extra.status ?? null,
      data,
      updatedAt,
      stale: (mode === Mode.LOCAL || mode === Mode.WEB) && updatedAt ? isStale(updatedAt, now()) : false,
      errors: extra.errors || [],
      message: extra.message || safeMessage(mode, { status: extra.status }),
    };
  }

  async function readFile(url) {
    if (!isLocalPath(url)) throw new Error('Yalnız yerel yol');
    return fetchFn(url, { method: 'GET', cache: 'no-store' });
  }

  async function parseBody(res, student) {
    let text;
    try { text = await res.text(); } catch { return { errors: [{ path: '', keyword: 'read', message: 'gövde okunamadı' }] }; }
    return parseText(text, student);
  }

  function parseText(text, student) {
    let data;
    try { data = JSON.parse(text); } catch { return { errors: [{ path: '', keyword: 'json', message: 'geçerli JSON değil' }] }; }
    const errors = validateData(student, data) || [];
    return errors.length ? { errors, data: null } : { errors: [], data };
  }

  /** Yerel kayıt data/<a|b>.json; web yayınında şifreli web/<a|b>.enc.json. */
  async function load(student) {
    if (student !== 'A' && student !== 'B') throw new Error(`Bilinmeyen öğrenci: ${student}`);
    if (source === 'web') return loadWeb(student);
    const file = `${localBase}${student.toLowerCase()}.json`;
    let res;
    try { res = await readFile(file); } catch { return result(student, Mode.ERROR, { message: 'Kayıt okunamadı: sayfa yerel sunucudan açılmalı (file:// çalışmaz).' }); }
    if (res.status === 404) return result(student, Mode.MISSING, { status: 404 });
    if (!res.ok) return result(student, Mode.ERROR, { status: res.status });
    const parsed = await parseBody(res, student);
    if (!parsed.data) return result(student, Mode.INVALID_DATA, { status: res.status, errors: parsed.errors, message: `Kayıt dosyası (${file}) şemaya uymuyor. Ayrıntılar aşağıda.` });
    return result(student, Mode.LOCAL, { status: res.status, data: parsed.data });
  }

  async function loadWeb(student) {
    const file = `${webBase}${student.toLowerCase()}.enc.json`;
    let res;
    try { res = await readFile(file); } catch { return result(student, Mode.ERROR, { message: 'Kayıt okunamadı (bağlantı yok?).' }); }
    if (res.status === 404) return result(student, Mode.MISSING, { status: 404, message: 'Web\'de bu öğrenci için kayıt yok — bilgisayardaki MyTaskBar Pronote\'tan yenileyince yayınlanır.' });
    if (!res.ok) return result(student, Mode.ERROR, { status: res.status });
    let env;
    try { env = JSON.parse(await res.text()); } catch { env = null; }
    if (!isEnvelope(env)) return result(student, Mode.INVALID_DATA, { status: res.status, errors: [{ path: '', keyword: 'envelope', message: 'şifreli kayıt biçimi tanınmadı' }] });
    lastEnvelope = env;
    // özel bağlantıdaki anahtar (#k=…) önce denenir; tutarsa saklanır, sonraki açılışlarda bağlantı gerekmez
    // A ve B aynı anda yüklenir: deneme tek söz (promise) üzerinden paylaşılır, ikincisi sonucu bekler
    let linkOk = false;
    if (linkKey) {
      if (!linkCheck) {
        linkCheck = decryptEnvelope(env, linkKey).then(() => {
          if (keyStore) keyStore.set(env.salt, linkKey, { remember: true });
          return true;
        }, () => false);
      }
      linkOk = await linkCheck;
    }
    const keyHex = (keyStore ? keyStore.get(env.salt) : null) || (linkOk ? linkKey : null);
    if (!keyHex) return result(student, Mode.LOCKED, { status: res.status, ...(linkKey && !linkOk ? { message: 'Bu bağlantı artık geçmiyor (anahtar değişmiş olabilir). Yeni bağlantıyı açın ya da şifreyi girin.' } : {}) });
    let text;
    try { text = await decryptEnvelope(env, keyHex); } catch {
      keyStore.clear();
      return result(student, Mode.LOCKED, { status: res.status, message: 'Kayıtlı şifre artık geçmiyor (şifre değişmiş olabilir). Yeni şifreyi girin.' });
    }
    const parsed = parseText(text, student);
    if (!parsed.data) return result(student, Mode.INVALID_DATA, { status: res.status, errors: parsed.errors });
    return result(student, Mode.WEB, { status: res.status, data: parsed.data });
  }

  /** Şifreyi son okunan şifreli kayıtla dener; tutarsa türetilmiş anahtar keyStore'a yazılır (şifre yazılmaz). */
  async function unlock(password, { remember = true } = {}) {
    if (!lastEnvelope || typeof password !== 'string' || !password) return false;
    const env = lastEnvelope;
    let keyHex;
    try {
      keyHex = await deriveKeyHex(password, env.salt, env.iter);
      await decryptEnvelope(env, keyHex);
    } catch { return false; }
    if (keyStore) keyStore.set(env.salt, keyHex, { remember });
    return true;
  }

  /** Örnek (uydurma) veri — yalnız kullanıcı düğmeyle isterse. */
  async function loadDemo(student) {
    const file = `${demoBase}${student.toLowerCase()}.example.json`;
    let res;
    try { res = await readFile(file); } catch { return result(student, Mode.ERROR, { message: 'Örnek veri yüklenemedi.' }); }
    if (!res.ok) return result(student, Mode.ERROR, { status: res.status, message: 'Örnek veri yüklenemedi.' });
    const parsed = await parseBody(res, student);
    if (!parsed.data) return result(student, Mode.INVALID_DATA, { status: res.status, errors: parsed.errors });
    return result(student, Mode.DEMO, { status: res.status, data: parsed.data });
  }

  return { load, unlock, loadDemo, source };
}
