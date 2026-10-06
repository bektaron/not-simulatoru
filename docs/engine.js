/**
 * Not simülatörü hesap motoru.
 *
 * Saf fonksiyonlar: DOM'a, localStorage'a veya ağa dokunmaz. Aynı dosya
 * tarayıcıda ES module olarak, Node'da `node --test` ile kullanılır.
 *
 * Sözleşme (bkz. README):
 *   weightedAverage(items)                         [{note, outOf, coef}] → /20 ölçeğinde number | null
 *   pronoteAverage(grades)                         Pronote ders ortalaması (20'ye çevir · bonus · facultatif) → number | null
 *   officialNote(subject, x)                       resmî yuvarlama (kontrol continu ↑0,1 · EPS tam puan)
 *   finalBac(config, notes)                        → {final (aşağı kesik), raw, lockedAvg, restAvg, totalCoef, effective, ...}
 *   mention(final, mentionsOrConfig)               → {label, level, threshold, tone} | null
 *   nextThreshold(final, config)                   → {threshold, label, gapPoints, gapWeighted} | null
 *   requiredNote(config, notes, subjectId, target) → number | 'unreachable' | 'safe'
 *   requiredAverage(config, notes, target, {pinned}) → serbest derslerde gereken ort. | 'unreachable' | 'safe' | null
 *   distributeToTarget(config, notes, target, {pinned}) → {reachable, notes, delta, raw, final, best, free}
 *   effortBreakdown(config, before, after, {pinned}) → {rows:[{subjectId, before, after, delta, gain, pinned}], rawBefore, rawAfter}
 *   leverage(config, opts)                         → [{subjectId, label, coef, deltaPerPoint}]
 *   termAverage(config, gradesBySubject)           → {subjects, general}
 *   requiredTermNote(config, bySubject, target, {subjectId, count, coef}) → number | 'unreachable' | 'safe'
 *   overallCheck(config, data)                      → okul katsayısı sınaması: Pronote genel ort. ↔ simülatör
 *   specialiteScenarios(config, baseNotes, candidates) → [{dropped, kept, final, mention}]
 *
 * Veri dosyası yardımcıları (şema: schema/notes.schema.json):
 *   gradesBySubject(grades, {period, defaultPeriod})
 *   subjectAverages(grades, opts) · yearAverages(grades, {defaultPeriod})
 *   lockedToNotes(locked)
 *   deriveScenario(config, grades, opts)
 *   buildBacNotes(config, data, scenarioName)
 *   withLabels(config, subjectLabels) · withOptions(config, enabledOptions) · resolveOptions(config, data, chosen)
 *
 * Notlar 0–20 ölçeğinde sayıdır. Eksik (null/undefined) not, hem paydan hem
 * paydadan düşülür ve `missing` listesinde raporlanır.
 *
 * Resmî kurallar (kaynaklar: outputs/reports/2026-10-06_not-simulatoru-resmi-kurallar.md):
 *   - genel ortalama = Σ(not × katsayı) / Σ katsayı; eşik ve mention yuvarlanmamış değerle (D334-8)
 *   - kontrol continu yıllık ortalaması bir üst onda bire yuvarlanır (NS 25-8-2025) → rounding 'ceil-0.1'
 *   - EPS = CCF ortalaması, en yakın tam puana yuvarlanır (NS 20-2-2026) → rounding 'round-1'
 *   - sınav notları tam puandır; bu bir girdi kuralıdır (config `step: 1`), senaryodaki beklenti yuvarlanmaz
 */

const EPS = 1e-9;

export const SCENARIO_NAMES = ['kotu', 'gercekci', 'hedef'];

export const DEFAULT_MENTIONS = [
  { min: 0, level: 'refuse', label: 'Ajourné', tone: 'bad' },
  { min: 8, level: 'rattrapage', label: 'Rattrapage (sözlü telafi)', tone: 'bad' },
  { min: 10, level: 'admis', label: 'Admis · mention yok', short: 'Bac', tone: 'warn' },
  { min: 12, level: 'assez-bien', label: 'Assez bien', short: 'Assez bien', tone: 'acc' },
  { min: 14, level: 'bien', label: 'Bien', short: 'Bien', tone: 'good' },
  { min: 16, level: 'tres-bien', label: 'Très bien', short: 'Très bien', tone: 'good' },
  { min: 18, level: 'felicitations', label: 'Très bien · félicitations', short: 'Félicitations', tone: 'good' },
];

/* ------------------------------------------------------------------ */
/* Yardımcılar                                                         */
/* ------------------------------------------------------------------ */

export function isNote(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** İki ondalığa yuvarlar (yarım yukarı). */
export function round2(x) {
  if (!isNote(x)) return x == null ? null : x;
  return Math.round(x * 100 + (x >= 0 ? EPS : -EPS)) / 100;
}

/** num/den bölümünü iki ondalığa yuvarlar; ara çarpım kayan nokta hatasını azaltır. */
function divRound2(num, den) {
  return Math.round((num * 100) / den + EPS) / 100;
}

/**
 * İki ondalıkta aşağı keser: gösterilen ortalama gerçeğini hiç aşmaz
 * (9,995 → 9,99; yarım-yukarı "10,00" yazıp yanında "rattrapage" göstermesin).
 */
export function floor2(x) {
  if (!isNote(x)) return x == null ? null : x;
  return Math.floor(x * 100 + EPS * 1000) / 100;
}

/** Resmî yuvarlama kuralı: 'ceil-0.1' (kontrol continu) · 'round-1' (EPS) · yoksa dokunmaz. */
export function applyRounding(rule, x) {
  if (!isNote(x)) return x;
  if (rule === 'ceil-0.1') return Math.ceil(x * 10 - EPS * 1000) / 10;
  if (rule === 'round-1') return Math.floor(x + 0.5 + EPS);
  return x;
}

/** Dersin bac'a giren resmî notu (config `rounding` alanına göre). */
export function officialNote(subject, x) {
  return applyRounding(subject && subject.rounding, x);
}

/** Dersin girdi ızgarası: önce resmî yuvarlama, yoksa `step`'e (varsayılan 0,25) en yakın değer. */
export function toSubjectGrid(subject, x, defaultStep = 0.25) {
  if (!isNote(x)) return x;
  if (subject && subject.rounding) return officialNote(subject, x);
  return snapToStep(x, (subject && isNote(subject.step) && subject.step > 0) ? subject.step : defaultStep);
}

export function snapToStep(x, step = 0.25) {
  return Math.round(x / step) * step;
}

export function ceilToStep(x, step = 0.25) {
  return Math.ceil(x / step - EPS) * step;
}

export function clamp(x, min, max) {
  return Math.min(max, Math.max(min, x));
}

/** Ham notu /20 ölçeğine çevirir (outOf varsayılan 20). */
export function noteOn20(note, outOf = 20) {
  if (!isNote(note)) return null;
  const d = isNote(outOf) && outOf > 0 ? outOf : 20;
  return (note / d) * 20;
}

function normalizeMentions(m) {
  const list = Array.isArray(m) ? m : (m && Array.isArray(m.mentions) ? m.mentions : DEFAULT_MENTIONS);
  return [...list].sort((a, b) => a.min - b.min);
}

/* ------------------------------------------------------------------ */
/* Config / opsiyonlar / etiketler                                     */
/* ------------------------------------------------------------------ */

/**
 * Temel dersler + açık opsiyonların dersleri.
 * enabledOptions: { lvc: true } gibi.
 */
export function resolveSubjects(config, enabledOptions = {}) {
  const base = Array.isArray(config.subjects) ? config.subjects : [];
  const extra = [];
  for (const opt of config.options || []) {
    if (enabledOptions[opt.id]) {
      for (const s of opt.subjects || []) extra.push({ ...s, option: opt.id });
    }
  }
  return [...base, ...extra];
}

/**
 * Açık opsiyonlar: veri dosyası `options` + kullanıcı seçimi (`chosen`) + zorunlu olanlar.
 * `autoIfLocked: true` opsiyon, dersinin kilitli notu veride varsa her zaman açıktır:
 * takip edilmiş opsiyonun notu bac'a girmek zorundadır (arrêté 16-7-2018 m. 2-1; NS 25-8-2025).
 * Dönen: { options: {id: bool}, forced: [id] }
 */
export function resolveOptions(config, data = {}, chosen = {}) {
  const locked = lockedToNotes(data && data.locked);
  const options = { ...((data && data.options) || {}), ...(chosen || {}) };
  const forced = [];
  for (const o of config.options || []) {
    if (o.autoIfLocked && (o.subjects || []).length && o.subjects.every((s) => isNote(locked[s.id]))) {
      options[o.id] = true;
      forced.push(o.id);
    }
  }
  return { options, forced };
}

/** Opsiyonları çözümlenmiş yeni bir config döndürür; girdi değişmez. */
export function withOptions(config, enabledOptions = {}) {
  return {
    ...config,
    subjects: resolveSubjects(config, enabledOptions),
    enabledOptions: { ...enabledOptions },
  };
}

/** Veri dosyasındaki subjectLabels ile ders etiketlerini değiştirir; girdi değişmez. */
export function withLabels(config, subjectLabels = {}) {
  if (!subjectLabels || typeof subjectLabels !== 'object') return config;
  const relabel = (s) => (typeof subjectLabels[s.id] === 'string' && subjectLabels[s.id].trim()
    ? { ...s, label: subjectLabels[s.id].trim(), genericLabel: s.label }
    : s);
  return {
    ...config,
    subjects: (config.subjects || []).map(relabel),
    options: (config.options || []).map((o) => ({ ...o, subjects: (o.subjects || []).map(relabel) })),
  };
}

/** Tüm dersler (tüm opsiyonlar açık sayılarak) — kimlik denetimi için. */
export function allSubjectIds(config) {
  const all = Object.fromEntries((config.options || []).map((o) => [o.id, true]));
  return new Set(resolveSubjects(config, all).map((s) => s.id));
}

/** Katsayı toplamları: tümü / kilitli / kalan. Config'ten okunur, sabit kodlanmaz. */
export function coefTotals(config) {
  const t = { total: 0, locked: 0, rest: 0 };
  for (const s of config.subjects || []) {
    const c = isNote(s.coef) ? s.coef : 0;
    t.total += c;
    if (s.locked) t.locked += c;
    else t.rest += c;
  }
  return t;
}

/** Grup bazında katsayı toplamı: { groupId: toplam }. */
export function groupTotals(config) {
  const out = {};
  for (const s of config.subjects || []) {
    if (!s.group) continue;
    out[s.group] = (out[s.group] || 0) + (isNote(s.coef) ? s.coef : 0);
  }
  return out;
}

/** Config tutarlılık kontrolü; hata mesajları listesi döner (boşsa geçerli). */
export function validateConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object') return ['config bir nesne değil'];
  const all = resolveSubjects(config, Object.fromEntries((config.options || []).map((o) => [o.id, true])));
  const ids = new Set();
  const groups = new Set((config.groups || []).map((g) => g.id));
  for (const s of all) {
    if (!s.id) errors.push('id eksik olan ders var');
    else if (ids.has(s.id)) errors.push(`tekrarlayan ders id: ${s.id}`);
    ids.add(s.id);
    if (!isNote(s.coef) || s.coef <= 0) errors.push(`geçersiz katsayı: ${s.id}`);
    if (s.group && groups.size && !groups.has(s.group)) errors.push(`bilinmeyen grup: ${s.id} → ${s.group}`);
  }
  const ms = normalizeMentions(config.mentions);
  for (let i = 1; i < ms.length; i++) {
    if (!(ms[i].min > ms[i - 1].min)) errors.push('mention eşikleri artan sırada değil');
  }
  return errors;
}

/* ------------------------------------------------------------------ */
/* Hesaplar                                                            */
/* ------------------------------------------------------------------ */

/**
 * Ağırlıklı ortalama, /20 ölçeğinde. Kalem: {note, outOf?, coef?}.
 * Notu olmayan (null) veya katsayısı ≤ 0 olan kalemler atlanır.
 * Hiç geçerli kalem yoksa null döner.
 */
export function weightedAverage(items) {
  let num = 0;
  let den = 0;
  for (const it of items || []) {
    if (!it) continue;
    const n = noteOn20(it.note, it.outOf);
    if (n == null) continue;
    const coef = isNote(it.coef) ? it.coef : 1;
    if (coef <= 0) continue;
    num += n * coef;
    den += coef;
  }
  return den > 0 ? num / den : null;
}

/**
 * Bac final ortalaması.
 * notes: { subjectId: number } — her not önce dersin resmî yuvarlamasından geçer (`effective`).
 * Dönen: { final, raw, lockedAvg, restAvg, lockedSum, restSum, totalCoef, lockedCoef, restCoef, countedCoef, weightedSum, missing, effective }
 * final iki ondalıkta AŞAĞI kesiktir (gösterim); eşik/mention için raw kullanılır.
 * lockedAvg / restAvg iki ondalığa yuvarlıdır (bilgi amaçlı).
 */
export function finalBac(config, notes = {}) {
  const subjects = config.subjects || [];
  const totals = coefTotals(config);
  let num = 0, den = 0, lnum = 0, lden = 0, rnum = 0, rden = 0;
  const missing = [];
  const effective = {};
  for (const s of subjects) {
    if (!isNote(notes[s.id])) { missing.push(s.id); continue; }
    const n = officialNote(s, notes[s.id]);
    effective[s.id] = n;
    num += n * s.coef;
    den += s.coef;
    if (s.locked) { lnum += n * s.coef; lden += s.coef; } else { rnum += n * s.coef; rden += s.coef; }
  }
  return {
    final: den > 0 ? floor2(num / den) : null,
    raw: den > 0 ? num / den : null,
    lockedAvg: lden > 0 ? divRound2(lnum, lden) : null,
    restAvg: rden > 0 ? divRound2(rnum, rden) : null,
    lockedSum: lnum,
    restSum: rnum,
    totalCoef: totals.total,
    lockedCoef: totals.locked,
    restCoef: totals.rest,
    countedCoef: den,
    weightedSum: num,
    missing,
    effective,
  };
}

/** Ortalamaya karşılık gelen mention. İkinci argüman mention listesi veya config olabilir. */
export function mention(final, mentionsOrConfig = DEFAULT_MENTIONS) {
  if (!isNote(final)) return null;
  const list = normalizeMentions(mentionsOrConfig);
  let cur = list[0];
  for (const m of list) if (final + EPS >= m.min) cur = m;
  return { label: cur.label, level: cur.level, threshold: cur.min, tone: cur.tone || 'acc' };
}

/**
 * Bir üst eşik ve ona kalan puan. gapPoints ortalama puanı, gapWeighted
 * katsayı-ağırlıklı puan (eşik × toplam katsayı − mevcut toplam). En üstteyse null.
 */
export function nextThreshold(final, mentionsOrConfig = DEFAULT_MENTIONS, totalCoef) {
  if (!isNote(final)) return null;
  const list = normalizeMentions(mentionsOrConfig);
  const K = isNote(totalCoef) ? totalCoef
    : (mentionsOrConfig && Array.isArray(mentionsOrConfig.subjects) ? coefTotals(mentionsOrConfig).total : null);
  for (const m of list) {
    if (m.min > 0 && m.min > final + EPS) {
      const gap = m.min - final;
      return {
        threshold: m.min,
        label: m.label,
        short: m.short || m.label,
        level: m.level,
        gapPoints: round2(gap),
        gapWeighted: K ? round2(gap * K) : null,
      };
    }
  }
  return null;
}

/**
 * Diğer notlar sabitken `subjectId` dersinde `target` ortalamasına ulaşmak için
 * gereken en düşük not. 20'yi aşarsa 'unreachable', 0 veya altındaysa 'safe'.
 */
export function requiredNote(config, notes = {}, subjectId, target) {
  const subjects = config.subjects || [];
  const subject = subjects.find((s) => s.id === subjectId);
  if (!subject) throw new Error(`Bilinmeyen ders: ${subjectId}`);
  let othersNum = 0;
  let den = subject.coef;
  for (const s of subjects) {
    if (s.id === subjectId) continue;
    const n = notes[s.id];
    if (!isNote(n)) continue;
    othersNum += officialNote(s, n) * s.coef;
    den += s.coef;
  }
  const n = (target * den - othersNum) / subject.coef;
  if (n > 20 + EPS) return 'unreachable';
  if (n <= EPS) return 'safe';
  return n;
}

/**
 * Hedef genel ortalamaya ulaşmak için serbest derslerin (kilitsiz ve `pinned` dışı) birlikte
 * tutturması gereken katsayı-ağırlıklı ortalama. Kilitli ve sabit dersler ekrandaki notlarında
 * kalır (resmî yuvarlamayla); serbest derslerin yuvarlaması hesaba girmez → yaklaşık değer.
 * Döner: number | 'unreachable' (20'yi aşar) | 'safe' (0 bile yeter) | null (serbest ders yok).
 */
export function requiredAverage(config, notes = {}, target, { pinned = [] } = {}) {
  const pin = new Set(pinned);
  let fixed = 0, den = 0, free = 0;
  for (const s of config.subjects || []) {
    const c = isNote(s.coef) ? s.coef : 0;
    if (c <= 0) continue;
    if (!s.locked && !pin.has(s.id)) { free += c; den += c; continue; }
    if (!isNote(notes[s.id])) continue;
    fixed += officialNote(s, notes[s.id]) * c;
    den += c;
  }
  if (free <= 0) return null;
  const n = (target * den - fixed) / free;
  if (n > 20 + EPS) return 'unreachable';
  if (n <= EPS) return 'safe';
  return n;
}

/**
 * Serbest derslerin notlarını aynı puan kadar (δ) kaydırıp genel ortalamayı hedefe getirir:
 * hedefi tutturan en küçük δ aranır (negatif olabilir — hedefin üstündeyse ne kadar pay olduğu görülür).
 * Yeni not dersin ızgarasına oturur (toSubjectGrid: sınav tam puan, kontrol continu ↑0,1, EPS tam puan)
 * ve 0–20'ye sıkışır; 20'ye dayanan dersin eksiği diğerlerine kalır. Kilitli, sabit (`pinned`) ve
 * notu olmayan dersler değişmez. Ortalama δ'ya göre azalmayan bir basamak fonksiyonu → ikili arama.
 * Döner: { reachable, notes, delta, raw, final, best, free }
 *   best = serbest derslerin hepsi 20 iken ulaşılabilen en yüksek ortalama (raw);
 *   ulaşılamazsa notes girdinin kopyasıdır, delta null.
 */
export function distributeToTarget(config, notes = {}, target, { pinned = [], defaultStep = 0.25 } = {}) {
  const pin = new Set(pinned);
  const free = (config.subjects || []).filter((s) => !s.locked && !pin.has(s.id) && isNote(notes[s.id]));
  const shifted = (d) => {
    const out = { ...notes };
    for (const s of free) out[s.id] = clamp(toSubjectGrid(s, notes[s.id] + d, defaultStep), 0, 20);
    return out;
  };
  const rawAt = (d) => finalBac(config, shifted(d)).raw;
  const ids = free.map((s) => s.id);
  const best = free.length ? rawAt(20) : finalBac(config, notes).raw;
  if (!free.length || !isNote(best) || best + EPS < target) {
    return { reachable: false, notes: { ...notes }, delta: null, raw: null, final: null, best, free: ids };
  }
  let lo = -20;
  let hi = 20;
  if (rawAt(lo) + EPS >= target) hi = lo;
  else {
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (rawAt(mid) + EPS >= target) hi = mid; else lo = mid;
    }
  }
  const out = shifted(hi);
  const T = finalBac(config, out);
  return { reachable: true, notes: out, delta: hi, raw: T.raw, final: T.final, best, free: ids };
}

/**
 * Hedef dağıtımının ders ders dökümü ("Emek nereye?" hedef görünümü): önce/sonra resmî not, fark ("emek")
 * ve genel ortalamaya katkısı (fark × katsayı / sayılan katsayı). Sabit dersler emek almaz, sona dizilir;
 * diğerleri katkıya göre azalan sırada. Katkıların toplamı rawAfter − rawBefore'dur (eksik not yoksa).
 */
export function effortBreakdown(config, before = {}, after = {}, { pinned = [] } = {}) {
  const pin = new Set(pinned);
  const B = finalBac(config, before);
  const A = finalBac(config, after);
  const K = A.countedCoef;
  const rows = (config.subjects || []).filter((s) => !s.locked).map((s) => {
    const b = isNote(B.effective[s.id]) ? B.effective[s.id] : null;
    const a = isNote(A.effective[s.id]) ? A.effective[s.id] : null;
    const delta = b !== null && a !== null ? round2(a - b) : null;
    return {
      subjectId: s.id, label: s.label, coef: s.coef, pinned: pin.has(s.id),
      before: b, after: a, delta, gain: delta !== null && K > 0 ? (delta * s.coef) / K : null,
    };
  });
  rows.sort((x, y) => (x.pinned - y.pinned) || ((y.gain ?? -Infinity) - (x.gain ?? -Infinity)) || (y.coef - x.coef));
  return { rows, rawBefore: B.raw, rawAfter: A.raw, finalBefore: B.final, finalAfter: A.final };
}

/**
 * Dersin girdi adımı: config `step` (sınav 1 · EPS 1 · kontrol continu 0,1), yoksa varsayılan.
 * "Gereken not" bu adıma yukarı yuvarlanır — sınavda 13,15 gerekiyorsa 14 yazılır.
 */
export function inputStep(subject, defaultStep = 0.25) {
  return subject && isNote(subject.step) && subject.step > 0 ? subject.step : defaultStep;
}

/**
 * "+1 puan"ın genel ortalamaya katkısı, katsayıya göre azalan sırada.
 * Varsayılan olarak yalnız değişken (kilitsiz) dersler.
 */
export function leverage(config, { includeLocked = false } = {}) {
  const subjects = config.subjects || [];
  const total = coefTotals(config).total;
  return subjects
    .filter((s) => includeLocked || !s.locked)
    .map((s) => ({
      subjectId: s.id,
      label: s.label,
      coef: s.coef,
      locked: !!s.locked,
      deltaPerPoint: total > 0 ? s.coef / total : 0,
    }))
    .sort((a, b) => b.coef - a.coef);
}

/* ------------------------------------------------------------------ */
/* Veri dosyası yardımcıları                                           */
/* ------------------------------------------------------------------ */

/**
 * Ham not listesini ders bazında gruplar.
 * period verilirse yalnız o dönemin notları (notun `period` alanı yoksa
 * defaultPeriod sayılır); verilmezse tümü.
 */
export function gradesBySubject(grades, { period, defaultPeriod } = {}) {
  const out = {};
  for (const g of Array.isArray(grades) ? grades : []) {
    if (!g || typeof g.subjectId !== 'string') continue;
    if (period != null) {
      const p = isNote(g.period) ? g.period : defaultPeriod;
      if (p !== period) continue;
    }
    (out[g.subjectId] ||= []).push(g);
  }
  return out;
}

/**
 * Pronote'un ders ortalaması (Index Éducation kuralları), /20 ölçeğinde.
 * Not alanları: note · outOf (vars. 20) · coef (vars. 1; 0 = sayılmaz) · outOf20 · bonus · optional.
 *   - genel formül 20 × Σ(kats.·n′) / Σ(kats.·b′): "20'ye çevir" işaretli (outOf20 !== false) notta
 *     n′ = not/barem·20, b′ = 20; işaretsizde (outOf20 === false) n′ = not, b′ = barem (puanlar havuzlanır).
 *     Bayrak yoksa işaretli sayılır (eski veri bu şekilde hesaplanıyordu).
 *   - bonus: yalnız barem yarısının üstü paya eklenir, payda değişmez.
 *   - optional (facultatif): yüksekten düşüğe denenir; o anki ortalamayı yükseltiyorsa sayılır.
 * Not yok (null: Abs · Disp · N.Not …) → atlanır. Zorunlu/isteğe bağlı not yoksa null.
 */
export function pronoteAverage(grades) {
  let N = 0;
  let D = 0;
  const optional = [];
  const bonus = [];
  for (const g of grades || []) {
    if (!g || !isNote(g.note)) continue;
    const coef = isNote(g.coef) ? g.coef : 1;
    if (coef <= 0) continue;
    const outOf = isNote(g.outOf) && g.outOf > 0 ? g.outOf : 20;
    const [n, b] = g.outOf20 === false ? [g.note, outOf] : [(g.note / outOf) * 20, 20];
    const it = { n: n * coef, b: b * coef, ratio: n / b };
    if (g.bonus) bonus.push(it);
    else if (g.optional) optional.push(it);
    else { N += it.n; D += it.b; }
  }
  for (const it of optional.sort((a, b) => b.ratio - a.ratio)) {
    if (D === 0 || it.ratio > N / D + EPS) { N += it.n; D += it.b; }
  }
  if (D === 0) return null;
  for (const it of bonus) N += Math.max(0, it.n - it.b / 2);
  return (20 * N) / D;
}

/** Ders bazında /20 ortalama (Pronote kuralı): { subjectId: number } (notu olmayan ders yer almaz). */
export function subjectAverages(grades, opts = {}) {
  const by = gradesBySubject(grades, opts);
  const out = {};
  for (const [id, list] of Object.entries(by)) {
    const avg = pronoteAverage(list);
    if (avg != null) out[id] = avg;
  }
  return out;
}

/**
 * Yıl içi ortalama: her dönemin ders ortalaması ayrı hesaplanır, sonra dönem ortalamalarının
 * eşit ağırlıklı ortalaması alınır (resmî "moyenne des moyennes périodiques"; Pronote varsayılanı).
 * Dönen: { averages: {id: number}, periods: {id: kaç dönemden} }
 */
export function yearAverages(grades, { defaultPeriod } = {}) {
  const perPeriod = {};
  for (const g of Array.isArray(grades) ? grades : []) {
    if (!g || typeof g.subjectId !== 'string') continue;
    const p = isNote(g.period) ? g.period : (defaultPeriod ?? 1);
    ((perPeriod[g.subjectId] ||= {})[p] ||= []).push(g);
  }
  const averages = {};
  const periods = {};
  for (const [id, byP] of Object.entries(perPeriod)) {
    const avgs = Object.values(byP).map(pronoteAverage).filter((v) => v != null);
    if (!avgs.length) continue;
    averages[id] = avgs.reduce((a, b) => a + b, 0) / avgs.length;
    periods[id] = avgs.length;
  }
  return { averages, periods };
}

/** Veri dosyasındaki locked dizisini { id: note } haritasına çevirir. */
export function lockedToNotes(locked) {
  const out = {};
  for (const l of Array.isArray(locked) ? locked : []) {
    if (l && typeof l.id === 'string' && isNote(l.note)) out[l.id] = l.note;
  }
  return out;
}

/**
 * "Gerçekçi" senaryoyu mevcut ders ortalamalarından türetir.
 * Değişken (kilitsiz) her ders için: notu varsa yıl içi ortalaması (dönem ortalamalarının
 * ortalaması — yıllık ortalamanın resmî tanımı); yoksa mevcut ortalamaların ortalaması
 * (hiç yoksa 10). Değer dersin ızgarasına oturtulur (toSubjectGrid). Doldurulanlar `estimated`'da;
 * `periods` her dersin kaç dönemden türetildiğini verir (1 = yalnız ilk dönemden tahmin).
 */
export function deriveScenario(config, grades, opts = {}) {
  const { averages: avgs, periods } = yearAverages(grades, opts);
  const variable = (config.subjects || []).filter((s) => !s.locked);
  const known = variable.filter((s) => avgs[s.id] != null).map((s) => avgs[s.id]);
  const fallback = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 10;
  const notes = {};
  const estimated = [];
  for (const s of variable) {
    if (avgs[s.id] != null) notes[s.id] = toSubjectGrid(s, avgs[s.id]);
    else { notes[s.id] = toSubjectGrid(s, fallback); estimated.push(s.id); }
  }
  return { notes, estimated, averages: avgs, periods };
}

/**
 * Bir senaryo için tam not haritası: kilitli notlar (veri `locked`) +
 * değişken notlar (veri `scenarios[name]`, eksikler türetilmişten tamamlanır;
 * dosyada senaryo yoksa türetilmiş gerçekçi ±2).
 * Dönen: { notes, source: 'file'|'derived'|'mixed', estimated: [...] }
 */
export function buildBacNotes(config, data, scenarioName = 'gercekci') {
  const locked = lockedToNotes(data && data.locked);
  const derived = deriveScenario(config, data && data.grades, {
    defaultPeriod: data && data.period ? data.period.index : undefined,
  });
  const offset = scenarioName === 'kotu' ? -2 : scenarioName === 'hedef' ? 2 : 0;
  const fileScen = data && data.scenarios && data.scenarios[scenarioName];
  const notes = { ...locked };
  const estimated = [];
  let fromFile = 0;
  for (const s of (config.subjects || []).filter((x) => !x.locked)) {
    const v = fileScen && isNote(fileScen[s.id]) ? fileScen[s.id] : null;
    if (v != null) { notes[s.id] = v; fromFile++; continue; }
    notes[s.id] = clamp(toSubjectGrid(s, derived.notes[s.id] + offset), 0, 20);
    estimated.push(s.id);
  }
  const source = fromFile === 0 ? 'derived' : estimated.length === 0 ? 'file' : 'mixed';
  return { notes, source, estimated, averages: derived.averages, periods: derived.periods };
}

/* ------------------------------------------------------------------ */
/* Seconde: trimestre ortalaması                                       */
/* ------------------------------------------------------------------ */

/**
 * bySubject: { subjectId: [{note, outOf, coef, outOf20?, bonus?, optional?}] } (bkz. gradesBySubject)
 * Ders ortalaması = Pronote kuralı (pronoteAverage, /20); genel ortalama = ders
 * ortalamalarının config katsayılarıyla ağırlıklı ortalaması. Notu olmayan
 * ders genel ortalamaya girmez.
 */
export function termAverage(config, bySubject = {}) {
  const subjects = config.subjects || [];
  const perSubject = [];
  const items = [];
  for (const s of subjects) {
    const list = Array.isArray(bySubject[s.id]) ? bySubject[s.id] : [];
    const avg = pronoteAverage(list);
    const coef = isNote(s.coef) ? s.coef : 1;
    perSubject.push({
      subjectId: s.id,
      label: s.label,
      coef,
      optional: !!s.optional,
      average: avg == null ? null : round2(avg),
      count: list.filter((g) => g && isNote(g.note)).length,
    });
    if (avg != null) items.push({ note: avg, coef });
  }
  const g = weightedAverage(items);
  return {
    subjects: perSubject,
    general: g == null ? null : round2(g),
    countedCoef: items.reduce((a, b) => a + b.coef, 0),
  };
}

/** termAverage'ın yuvarlanmamış genel ortalaması (hedef aramaları için). */
function termGeneralRaw(config, bySubject) {
  const items = [];
  for (const s of config.subjects || []) {
    const avg = pronoteAverage(Array.isArray(bySubject[s.id]) ? bySubject[s.id] : []);
    if (avg != null) items.push({ note: avg, coef: isNote(s.coef) ? s.coef : 1 });
  }
  return weightedAverage(items);
}

/**
 * Okul katsayısı sınaması: Pronote'un kendi genel ortalaması (veri `pronoteOverall` {period, value} — MyTaskBar
 * Pronote'tan ham değer olarak yazar) ile simülatörün aynı dönem hesabı (Pronote ders ortalaması + config katsayıları;
 * yalnız dosyadaki notlar, geçici notlar hariç). Eşitse notu olan derslerin config katsayıları okulunkiyle orantılıdır.
 * Pronote iki ondalık gösterir (yuvarlama ya da kesme) → tolerans 0,01.
 * Döner: {status: 'none'|'match'|'mismatch', period, pronote, sim, delta, tested, testedMandatory, mandatory}
 */
export function overallCheck(config, data, { tolerance = 0.0101 } = {}) {
  const mandatory = (config.subjects || []).filter((s) => !s.optional).length;
  const po = data && data.pronoteOverall;
  if (!po || !isNote(po.value) || !isNote(po.period)) return { status: 'none', mandatory, tested: 0, testedMandatory: 0 };
  const by = gradesBySubject(data.grades, { period: po.period, defaultPeriod: data.period ? data.period.index : po.period });
  const T = termAverage(config, by);
  const withAvg = T.subjects.filter((s) => s.average != null);
  const base = { period: po.period, pronote: po.value, mandatory, tested: withAvg.length,
    testedMandatory: withAvg.filter((s) => !s.optional).length };
  const raw = termGeneralRaw(config, by);
  if (raw == null) return { ...base, status: 'none' };
  return { ...base, sim: round2(raw), delta: round2(raw - po.value),
    status: Math.abs(raw - po.value) <= tolerance ? 'match' : 'mismatch' };
}

/**
 * Trimestre hedefi: derslere `count` adet x notu (/20, not katsayısı `coef`) eklenirse genel ortalama
 * `target`'a ulaşır — gereken en küçük x. `subjectId` verilirse yalnız o derse eklenir (diğerleri
 * olduğu gibi); verilmezse her derse: zorunlu dersler (notu olmasa da — eklenen notla ortalamaya
 * girer) + notu olan opsiyonel dersler. Genel ortalama x'e göre azalmaz → ikili arama.
 * Döner: number | 'unreachable' (20 bile yetmez) | 'safe' (0 bile hedefi bozmaz).
 */
export function requiredTermNote(config, bySubject = {}, target, { subjectId = null, count = 1, coef = 1 } = {}) {
  const has = (id) => (bySubject[id] || []).some((g) => g && isNote(g.note));
  const subjects = (config.subjects || []).filter((s) => (subjectId ? s.id === subjectId : (!s.optional || has(s.id))));
  if (subjectId && !subjects.length) throw new Error(`Bilinmeyen ders: ${subjectId}`);
  const n = Math.max(1, Math.floor(count));
  const genAt = (x) => {
    const by = { ...bySubject };
    for (const s of subjects) {
      by[s.id] = [...(Array.isArray(by[s.id]) ? by[s.id] : []), ...Array.from({ length: n }, () => ({ note: x, outOf: 20, coef }))];
    }
    return termGeneralRaw(config, by);
  };
  const top = genAt(20);
  if (!isNote(top) || top + EPS < target) return 'unreachable';
  if (genAt(0) + EPS >= target) return 'safe';
  let lo = 0;
  let hi = 20;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (genAt(mid) + EPS >= target) hi = mid; else lo = mid;
  }
  return hi;
}

/* ------------------------------------------------------------------ */
/* Bac projeksiyonu: spécialité bırakma senaryoları                    */
/* ------------------------------------------------------------------ */

/**
 * Üç spécialité adayından her birinin "1ère sonunda bırakılması" senaryosu.
 * Config'te role: 'spe-dropped' (1 ders) ve role: 'spe-kept' (2 ders) yuvaları olmalı.
 * candidates: [{id, label, note}] — her aday için tahmini not.
 */
export function specialiteScenarios(config, baseNotes = {}, candidates = []) {
  const subjects = config.subjects || [];
  const dropped = subjects.find((s) => s.role === 'spe-dropped');
  const kept = subjects.filter((s) => s.role === 'spe-kept');
  if (!dropped || kept.length < 2) {
    throw new Error('Config içinde spécialité yuvaları eksik (role: spe-dropped / spe-kept).');
  }
  const valid = candidates.filter((c) => c && isNote(c.note)).slice(0, 3);
  if (valid.length < 3) return [];
  return valid.map((c, i) => {
    const others = valid.filter((_, j) => j !== i);
    const notes = {
      ...baseNotes,
      [dropped.id]: c.note,
      [kept[0].id]: others[0].note,
      [kept[1].id]: others[1].note,
    };
    const result = finalBac(config, notes);
    return {
      dropped: c,
      kept: others,
      final: result.final,
      mention: mention(result.final, config),
      result,
    };
  });
}
