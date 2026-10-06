import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as E from '../docs/engine.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const cfg2027 = read('../docs/config/bac-2027.json');
const cfg2029 = read('../docs/config/bac-2029.json');
const cfgSec = read('../docs/config/seconde-2026.json');
const exA = read('../docs/examples/a.example.json');
const exB = read('../docs/examples/b.example.json');

test('config dosyaları tutarlı', () => {
  for (const c of [cfg2027, cfg2029, cfgSec]) assert.deepEqual(E.validateConfig(c), [], c.id);
});

test('weightedAverage: katsayı, outOf ve null not', () => {
  assert.equal(E.weightedAverage([{ note: 12, coef: 1 }, { note: 14, coef: 2 }]), 40 / 3);
  assert.equal(E.weightedAverage([{ note: 8.5, outOf: 10 }]), 17);
  assert.equal(E.weightedAverage([{ note: null }, { note: 15 }]), 15);
  assert.equal(E.weightedAverage([]), null);
  assert.equal(E.weightedAverage([{ note: 10, coef: 0 }]), null);
});

test('pronoteAverage: 20\'ye çevir / havuzla (Index Éducation örneği: 8,67 ↔ 12)', () => {
  const g = [{ note: 18, outOf: 20 }, { note: 2, outOf: 10 }, { note: 1, outOf: 5 }];
  assert.ok(Math.abs(E.pronoteAverage(g) - 26 / 3) < 1e-12); // bayrak yok → 20'ye çevrilmiş sayılır
  assert.equal(E.pronoteAverage(g.map((x) => ({ ...x, outOf20: false }))), 12);
  // karışık: 18/20 havuz + 2/10 çevrilmiş → 20·(18 + 4)/(20 + 20) = 11
  assert.equal(E.pronoteAverage([{ note: 18, outOf: 20, outOf20: false }, { note: 2, outOf: 10, outOf20: true }]), 11);
  assert.equal(E.pronoteAverage([{ note: 12, coef: 1 }, { note: 14, coef: 2 }]), 40 / 3);
  assert.equal(E.pronoteAverage([{ note: 10, coef: 0 }]), null);
  assert.equal(E.pronoteAverage([{ note: null }, { note: 15 }]), 15);
});

test('pronoteAverage: bonus yalnız 10 üstü, facultatif yalnız yükseltirse', () => {
  const base = [{ note: 12 }, { note: 16 }];
  assert.equal(E.pronoteAverage([...base, { note: 17, bonus: true }]), 17.5); // (12 + 16 + 7) / 2
  assert.equal(E.pronoteAverage([...base, { note: 8, bonus: true }]), 14);
  // forum örneği: 14 + bonus 3,75/5 kats. 0,5 → +2,5 → 16,5
  assert.equal(E.pronoteAverage([{ note: 14 }, { note: 3.75, outOf: 5, coef: 0.5, bonus: true }]), 16.5);
  const comp = [{ note: 16 }, { note: 18 }];
  assert.equal(E.pronoteAverage([...comp, { note: 20, optional: true }]), 18);              // 17 → 18
  assert.equal(E.pronoteAverage([...comp, { note: 17, optional: true }]), 17);              // eşit: sayılmaz
  assert.equal(E.pronoteAverage([...comp, { note: 20, optional: true }, { note: 17, optional: true }]), 18);
  // eşit facultatif sayılmaz — bonusla birlikte fark eder: 20·(34 + 2)/40 = 18 (sayılsaydı 20·53/60 = 17,67)
  assert.equal(E.pronoteAverage([...comp, { note: 17, optional: true }, { note: 12, bonus: true }]), 18);
  assert.equal(E.pronoteAverage([{ note: 9, optional: true }]), 9);                         // zorunlu yoksa ilki girer
  assert.equal(E.pronoteAverage([{ note: 15, bonus: true }]), null);
});

test('yearAverages: dönem ortalamalarının ortalaması (not sayısı ağırlık değil)', () => {
  const grades = [
    { subjectId: 'hg', note: 10, period: 1 }, { subjectId: 'hg', note: 14, period: 1 },
    { subjectId: 'hg', note: 16, period: 2 },
    { subjectId: 'lva', note: 13 }, // dönemsiz → defaultPeriod
  ];
  const y = E.yearAverages(grades, { defaultPeriod: 1 });
  assert.equal(y.averages.hg, 14); // (12 + 16) / 2, tüm notların ortalaması 13,33 olurdu
  assert.equal(y.periods.hg, 2);
  assert.equal(y.averages.lva, 13);
  assert.equal(y.periods.lva, 1);
  const d = E.deriveScenario(cfg2027, [{ subjectId: 'hg', note: 12.31 }, { subjectId: 'spe1', note: 12.6 }, { subjectId: 'eps', note: 14.5 }]);
  assert.equal(d.notes.hg, 12.4);   // kontrol continu ↑0,1
  assert.equal(d.notes.spe1, 13);   // sınav: tam puana en yakın
  assert.equal(d.notes.eps, 15);    // EPS: en yakın tam puan
});

test('A: katsayı toplamları config\'ten okunur: 33 kilitli + 67 kalan = 100', () => {
  const t = E.coefTotals(cfg2027);
  assert.equal(t.locked, 33);
  assert.equal(t.rest, 67);
  assert.equal(t.total, 100);
  const g = E.groupTotals(cfg2027);
  assert.equal(g['exam-tle'], 48);
  assert.equal(g['cc-tle'], 19);
  const withLvc = E.withOptions(cfg2027, { lvc1: true, lvc: true });
  assert.equal(E.coefTotals(withLvc).total, 104);
  assert.equal(E.coefTotals(E.withOptions(cfg2027, { lvc1: true })).total, 102); // yalnız 1ère'de takip
});

test('resolveOptions: kilitli 1ère LVC notu varsa lvc1 zorunlu açılır, Tle kutuyla', () => {
  const r = E.resolveOptions(cfg2027, exA, {});
  assert.deepEqual(r.forced, ['lvc1']);
  assert.equal(r.options.lvc1, true);
  assert.equal(r.options.lvc, false); // örnek dosyada options.lvc = false
  assert.equal(E.resolveOptions(cfg2027, exA, { lvc1: false }).options.lvc1, true); // kapatılamaz
  assert.equal(E.resolveOptions(cfg2027, exA, { lvc: true }).options.lvc, true);
  const noLvc1 = { ...exA, locked: exA.locked.filter((l) => l.id !== 'lvc1') };
  assert.deepEqual(E.resolveOptions(cfg2027, noLvc1, {}).forced, []);
});

test('A örnek verisi: final ortalama iki ondalığa kadar (elle hesap)', () => {
  // Kilitli: 5·12 + 5·14 + 2·11 + 3·13,5 + 3·15 + 3·12,5 + 3·11 + 1·15 + 8·12 = 419 (33 katsayı)
  // Gerçekçi: 16·12 + 16·11,5 + 8·10 + 8·13 + 6·14 + 3·12,5 + 3·14 + 3·12 + 3·11 + 1·13,5 = 806 (67 katsayı)
  // Final = (419 + 806) / 100 = 12,25
  const { notes } = E.buildBacNotes(cfg2027, exA, 'gercekci');
  const r = E.finalBac(cfg2027, notes);
  assert.equal(r.final, 12.25);
  assert.equal(r.lockedAvg, 12.7); // 419/33 = 12,6969… → 12,70
  assert.equal(r.restAvg, 12.03); // 806/67 = 12,0298… → 12,03
  assert.equal(r.lockedSum, 419);
  assert.equal(r.restSum, 806);
  assert.deepEqual(r.missing, []);
  // Kötü: 639 → (419 + 639)/100 = 10,58 · Hedef: 985 → 14,04
  assert.equal(E.finalBac(cfg2027, E.buildBacNotes(cfg2027, exA, 'kotu').notes).final, 10.58);
  assert.equal(E.finalBac(cfg2027, E.buildBacNotes(cfg2027, exA, 'hedef').notes).final, 14.04);
});

test('A örnek verisi + LVC iki yıl: (419 + 806 + 2·13 + 2·14) / 104 = 12,2980… → gösterim 12,29 (aşağı kesik)', () => {
  const cfg = E.withOptions(cfg2027, E.resolveOptions(cfg2027, exA, { lvc: true }).options);
  const { notes } = E.buildBacNotes(cfg, exA, 'gercekci');
  const r = E.finalBac(cfg, notes);
  assert.equal(r.totalCoef, 104);
  assert.equal(r.final, 12.29);
  assert.ok(Math.abs(r.raw - 1279 / 104) < 1e-12);
  // yalnız 1ère LVC (Tle'de bırakılmış): (1225 + 26) / 102 = 12,2647…
  const cfg1 = E.withOptions(cfg2027, E.resolveOptions(cfg2027, exA, {}).options);
  const r1 = E.finalBac(cfg1, E.buildBacNotes(cfg1, exA, 'gercekci').notes);
  assert.equal(r1.totalCoef, 102);
  assert.equal(r1.final, 12.26);
});

test('gösterilen ortalama aşağı kesilir, mention yuvarlanmamış değerle (9,995 → 9,99 · rattrapage)', () => {
  const notes = Object.fromEntries(cfg2027.subjects.map((s) => [s.id, 10]));
  notes.emc = 9.5; // 999,5 puan
  const r = E.finalBac(cfg2027, notes);
  assert.equal(r.final, 9.99);
  assert.equal(E.mention(r.raw, cfg2027).level, 'rattrapage');
  assert.equal(E.floor2(10), 10);
  assert.equal(E.floor2(12.3), 12.3);
  assert.equal(E.floor2(null), null);
});

test('resmî yuvarlama: kontrol continu ↑0,1 · EPS en yakın tam puan · sınav dokunulmaz', () => {
  assert.equal(E.applyRounding('ceil-0.1', 12.31), 12.4);
  assert.equal(E.applyRounding('ceil-0.1', 12.4), 12.4);
  assert.equal(E.applyRounding('ceil-0.1', 12.25), 12.3);
  assert.equal(E.applyRounding('ceil-0.1', 12.3), 12.3);
  assert.equal(E.applyRounding('round-1', 15.5), 16);
  assert.equal(E.applyRounding('round-1', 15.49), 15);
  assert.equal(E.applyRounding(undefined, 11.5), 11.5);
  const notes = Object.fromEntries(cfg2027.subjects.map((s) => [s.id, 10]));
  Object.assign(notes, { hg: 12.31, eps: 14.5, philo: 11.5 });
  const r = E.finalBac(cfg2027, notes);
  assert.equal(r.effective.hg, 12.4);
  assert.equal(r.effective.eps, 15);
  assert.equal(r.effective.philo, 11.5); // senaryodaki beklenti
  // 10·100 + 3·2,4 + 6·5 + 8·1,5 = 1049,2 → 10,492
  assert.ok(Math.abs(r.raw - 10.492) < 1e-9);
});

test('gereken not dersin adımına yukarı yuvarlanır: sınav tam puan, kontrol continu 0,1', () => {
  const notes = Object.fromEntries(cfg2027.subjects.map((s) => [s.id, 11.9]));
  const philo = cfg2027.subjects.find((s) => s.id === 'philo');
  const hg = cfg2027.subjects.find((s) => s.id === 'hg');
  const need = E.requiredNote(cfg2027, notes, 'philo', 12);
  // diğerleri resmî notlarıyla: EPS 11,9 → 12 · (1200 − (92·11,9 + 6·12)) / 8 = 13,075
  assert.ok(Math.abs(need - 13.075) < 1e-9);
  assert.equal(E.inputStep(philo), 1);
  assert.equal(E.ceilToStep(need, E.inputStep(philo)), 14);
  assert.equal(E.inputStep(hg), 0.1);
  assert.equal(E.inputStep({}), 0.25);
});

test('mention ve nextThreshold', () => {
  assert.equal(E.mention(7.9, cfg2027).level, 'refuse');
  assert.equal(E.mention(8, cfg2027).level, 'rattrapage');
  assert.equal(E.mention(10, cfg2027).level, 'admis');
  assert.equal(E.mention(12.25, cfg2027).level, 'assez-bien');
  assert.equal(E.mention(14, cfg2027).level, 'bien');
  assert.equal(E.mention(16, cfg2027).level, 'tres-bien');
  assert.equal(E.mention(18, cfg2027).level, 'felicitations');
  assert.equal(E.mention(null), null);
  const nx = E.nextThreshold(12.25, cfg2027);
  assert.equal(nx.threshold, 14);
  assert.equal(nx.gapPoints, 1.75);
  assert.equal(nx.gapWeighted, 175); // 1,75 × 100 katsayı
  assert.equal(E.nextThreshold(18.5, cfg2027), null);
  assert.equal(E.nextThreshold(7, cfg2027).threshold, 8);
});

test('requiredNote: unreachable / safe / sayı', () => {
  const { notes } = E.buildBacNotes(cfg2027, exA, 'gercekci');
  // Bien (14) için spe1 tek başına: (1400 − (1225 − 192)) / 16 = 22,94 → ulaşılamaz
  assert.equal(E.requiredNote(cfg2027, notes, 'spe1', 14), 'unreachable');
  // Admis (10) için emc tek başına: 1000 − (1225 − 13,5) < 0 → güvende
  assert.equal(E.requiredNote(cfg2027, notes, 'emc', 10), 'safe');
  // Assez bien (12) için spe1: (1200 − 1033) / 16 = 10,4375
  assert.equal(E.requiredNote(cfg2027, notes, 'spe1', 12), 10.4375);
  assert.throws(() => E.requiredNote(cfg2027, notes, 'yok', 12));
});

test('leverage: katsayıya göre azalan, yalnız değişken dersler', () => {
  const lv = E.leverage(cfg2027);
  assert.equal(lv.length, 10);
  assert.equal(lv[0].coef, 16);
  assert.equal(lv[0].deltaPerPoint, 0.16);
  for (let i = 1; i < lv.length; i++) assert.ok(lv[i - 1].coef >= lv[i].coef);
  assert.ok(lv.every((x) => !x.locked));
  assert.equal(E.leverage(cfg2027, { includeLocked: true }).length, 19);
});

test('withLabels: veri dosyası etiketleri config\'i değiştirmeden uygular', () => {
  const c = E.withLabels(cfg2027, { spe1: 'Örnek spé', bogus: 'x' });
  assert.equal(c.subjects.find((s) => s.id === 'spe1').label, 'Örnek spé');
  assert.equal(cfg2027.subjects.find((s) => s.id === 'spe1').label, 'Spécialité 1');
});

test('gradesBySubject / subjectAverages / deriveScenario', () => {
  const by = E.gradesBySubject(exA.grades, { period: 1, defaultPeriod: 1 });
  assert.equal(by.spe1.length, 2);
  const avgs = E.subjectAverages(exA.grades);
  assert.equal(avgs.spe1, (11.5 * 2 + 13) / 3);
  assert.equal(avgs.lva, 14); // 7/10 → 14/20
  assert.equal(avgs.emc, undefined); // tek not null
  const d = E.deriveScenario(cfg2027, exA.grades);
  assert.ok(d.estimated.includes('go'));
  assert.ok(d.estimated.includes('emc'));
  assert.ok(!d.estimated.includes('spe1'));
  assert.equal(d.notes.lva, 14);
});

test('buildBacNotes: dosyada senaryo yoksa türetilir ve ±2 uygulanır', () => {
  const data = { ...exA, scenarios: undefined };
  const g = E.buildBacNotes(cfg2027, data, 'gercekci');
  const k = E.buildBacNotes(cfg2027, data, 'kotu');
  const h = E.buildBacNotes(cfg2027, data, 'hedef');
  assert.equal(g.source, 'derived');
  assert.equal(k.notes.lva, 12);
  assert.equal(g.notes.lva, 14);
  assert.equal(h.notes.lva, 16);
  assert.equal(g.notes.fr_e, 12); // kilitli notlar dosyadan
  const mixed = E.buildBacNotes(cfg2027, { ...exA, scenarios: { gercekci: { spe1: 13 } } }, 'gercekci');
  assert.equal(mixed.source, 'mixed');
  assert.equal(mixed.notes.spe1, 13);
});

test('B örnek verisi: trimestre ortalaması (elle hesap)', () => {
  const by = E.gradesBySubject(exB.grades, { period: 1, defaultPeriod: 1 });
  const t = E.termAverage(cfgSec, by);
  const avg = Object.fromEntries(t.subjects.map((s) => [s.subjectId, s.average]));
  assert.equal(avg.fr, 13.33);     // (12 + 2·14)/3
  assert.equal(avg.maths, 14.33);  // (2·15 + 13)/3
  assert.equal(avg.snt, 17);       // 8,5/10
  assert.equal(avg.lvc, null);
  // Genel: (13,333 + 14,333 + 11,5 + 15,5 + 12 + 13 + 17 + 10,5 + 12,5 + 14 + 15 + 13) / 12 = 13,4722 → 13,47
  assert.equal(t.general, 13.47);
  assert.equal(t.countedCoef, 12);
  assert.equal(E.termAverage(cfgSec, {}).general, null);
  // ders ortalaması Pronote kuralıyla: 12 + bonus 16 → 12 + 6 = 18
  const tb = E.termAverage(cfgSec, { fr: [{ note: 12 }, { note: 16, bonus: true }] });
  assert.equal(tb.subjects.find((s) => s.subjectId === 'fr').average, 18);
});

test('specialiteScenarios: üç bırakma senaryosu', () => {
  const base = { fr_e: 12, fr_o: 13, ma_a: 13, hg1: 12, lva1: 15, lvb1: 12, es1: 12, emc1: 14, philo: 11, go: 13, eps: 14, hg: 12, lva: 15, lvb: 12, es: 12, emc: 14 };
  const sc = E.specialiteScenarios(cfg2029, base, [
    { id: 'maths', label: 'Maths', note: 14 },
    { id: 'pc', label: 'PC', note: 11 },
    { id: 'ses', label: 'SES', note: 13 },
  ]);
  assert.equal(sc.length, 3);
  const best = [...sc].sort((a, b) => b.final - a.final)[0];
  assert.equal(best.dropped.id, 'pc'); // en düşük not bırakılınca ortalama en yüksek
  assert.deepEqual(sc[0].result.missing, []);
  assert.deepEqual(E.specialiteScenarios(cfg2029, base, [{ id: 'maths', note: 14 }]), []);
});

/* hedef aracı: küçük elle hesaplanır config — L kilitli ×2 · a sınav ×2 (tam puan) · b kontrol continu ×1 (↑0,1) · p sınav ×1 */
const cfgT = {
  subjects: [
    { id: 'L', coef: 2, locked: true },
    { id: 'a', coef: 2, step: 1 },
    { id: 'b', coef: 1, step: 0.1, rounding: 'ceil-0.1' },
    { id: 'p', coef: 1, step: 1 },
  ],
};
const notesT = { L: 10, a: 12, b: 12, p: 8 }; // raw = 64 / 6

test('requiredAverage: serbest derslerde gereken ortalama, sabit ders hesaba sabit girer', () => {
  // sabit p: (12·6 − 10·2 − 8·1) / (2 + 1) = 44/3
  assert.ok(Math.abs(E.requiredAverage(cfgT, notesT, 12, { pinned: ['p'] }) - 44 / 3) < 1e-12);
  // sabitsiz: (72 − 20) / 4 = 13
  assert.equal(E.requiredAverage(cfgT, notesT, 12), 13);
  assert.equal(E.requiredAverage(cfgT, notesT, 19, { pinned: ['p'] }), 'unreachable');
  assert.equal(E.requiredAverage(cfgT, notesT, 14.9, { pinned: ['p'] }), 'unreachable'); // (89,4 − 28)/3 = 20,47 — tavanın hemen üstü
  assert.ok(Math.abs(E.requiredAverage(cfgT, notesT, 88 / 6, { pinned: ['p'] }) - 20) < 1e-9); // tam 20 hâlâ ulaşılabilir
  assert.equal(E.requiredAverage(cfgT, notesT, 3, { pinned: ['p'] }), 'safe');
  assert.equal(E.requiredAverage(cfgT, notesT, 12, { pinned: ['a', 'b', 'p'] }), null);
});

test('distributeToTarget: en küçük ortak kaydırma, ızgara + sabit ders korunur', () => {
  const r = E.distributeToTarget(cfgT, notesT, 12, { pinned: ['p'] });
  // 2a′ + b′ ≥ 44: δ < 2,5 iken a′ ≤ 14 → b′ ≥ 16 gerekir (δ ≥ 4); δ = 2,5 → a′ = 15, b′ = 14,5
  assert.equal(r.reachable, true);
  assert.ok(Math.abs(r.delta - 2.5) < 1e-9, String(r.delta));
  assert.deepEqual(r.notes, { L: 10, a: 15, b: 14.5, p: 8 });
  assert.ok(Math.abs(r.raw - 72.5 / 6) < 1e-12);
  assert.equal(r.final, 12.08);
  assert.deepEqual(r.free, ['a', 'b']);
  assert.ok(Math.abs(r.best - 88 / 6) < 1e-12); // serbestler 20: (20 + 40 + 20 + 8) / 6
  // girdi değişmez
  assert.deepEqual(notesT, { L: 10, a: 12, b: 12, p: 8 });
});

test('distributeToTarget: hedef altındaysa negatif kaydırma (pay) · 20 tavanı eksiği diğerine bırakır', () => {
  const down = E.distributeToTarget(cfgT, notesT, 10, { pinned: ['p'] });
  // 2a′ + b′ ≥ 32: δ = −1,5 → a′ = 11, b′ = 10,5
  assert.ok(Math.abs(down.delta + 1.5) < 1e-9, String(down.delta));
  assert.deepEqual(down.notes, { L: 10, a: 11, b: 10.5, p: 8 });
  const cap = E.distributeToTarget(cfgT, { ...notesT, a: 19 }, 14, { pinned: ['p'] });
  // 2a′ + b′ ≥ 56 → a 20'de kalır, b′ = 16: ↑0,1 kuralında 15,9'un hemen üstü 16'ya yuvarlanır → δ = 3,9⁺
  assert.ok(cap.delta > 3.9 && cap.delta < 3.9 + 1e-6, String(cap.delta));
  assert.deepEqual(cap.notes, { L: 10, a: 20, b: 16, p: 8 });
  assert.equal(cap.final, 14);
});

test('distributeToTarget: ulaşılamaz · serbest ders yok', () => {
  const r = E.distributeToTarget(cfgT, notesT, 15, { pinned: ['p'] });
  assert.equal(r.reachable, false);
  assert.equal(r.delta, null);
  assert.deepEqual(r.notes, notesT);
  assert.ok(Math.abs(r.best - 88 / 6) < 1e-12);
  const none = E.distributeToTarget(cfgT, notesT, 12, { pinned: ['a', 'b', 'p'] });
  assert.equal(none.reachable, false);
  assert.deepEqual(none.free, []);
});

test('distributeToTarget: A örnek verisi, spe1 sabit — hedef tutar, δ en küçük', () => {
  const cfg = E.withOptions(cfg2027, {});
  const { notes } = E.buildBacNotes(cfg, exA, 'gercekci');
  const target = 14;
  const r = E.distributeToTarget(cfg, notes, target, { pinned: ['spe1'] });
  assert.equal(r.reachable, true);
  assert.equal(r.notes.spe1, notes.spe1);
  assert.ok(r.raw + 1e-9 >= target);
  // δ'nın biraz altı hedefi tutturmamalı (aynı kural elle uygulanır)
  const under = { ...notes };
  for (const s of cfg.subjects.filter((x) => !x.locked && x.id !== 'spe1')) {
    under[s.id] = E.clamp(E.toSubjectGrid(s, notes[s.id] + r.delta - 1e-6, 0.25), 0, 20);
  }
  assert.ok(E.finalBac(cfg, under).raw < target);
});

test('buildBacNotes güncel: notu olan derste yıl içi Pronote ortalaması (ızgarada), olmayanda gerçekçi tahmin', () => {
  const cfg = E.withOptions(cfg2027, {});
  const base = E.buildBacNotes(cfg, exA, 'gercekci');
  const cur = E.buildBacNotes(cfg, exA, 'guncel');
  const { averages } = E.yearAverages(exA.grades, { defaultPeriod: exA.period.index });
  const variable = cfg.subjects.filter((s) => !s.locked);
  assert.equal(cur.source, 'current');
  assert.ok(cur.current.length > 0);
  for (const s of variable) {
    if (averages[s.id] != null) {
      assert.ok(cur.current.includes(s.id), s.id);
      assert.equal(cur.notes[s.id], E.toSubjectGrid(s, averages[s.id]), s.id);
    } else {
      assert.ok(cur.estimated.includes(s.id), s.id);
      assert.equal(cur.notes[s.id], base.notes[s.id], s.id);
    }
  }
  assert.equal(cur.current.length + cur.estimated.length, variable.length);
  // kilitli notlar aynen; not sayıları yalnız gerçek notlardan (Abs sayılmaz)
  for (const s of cfg.subjects.filter((x) => x.locked)) assert.equal(cur.notes[s.id], base.notes[s.id]);
  const n = exA.grades.filter((g) => g.subjectId === cur.current[0] && E.isNote(g.note)).length;
  assert.equal(cur.counts[cur.current[0]], n);
  // not hiç yoksa her ders tahmin, değerler gerçekçiyle aynı
  const none = E.buildBacNotes(cfg, { ...exA, grades: [] }, 'guncel');
  assert.deepEqual(none.current, []);
  assert.deepEqual(none.notes, E.buildBacNotes(cfg, { ...exA, grades: [] }, 'gercekci').notes);
});

test('effortBreakdown: önce/sonra resmî not, emek, genele katkı; sabit ders emeksiz en sonda', () => {
  const r = E.distributeToTarget(cfgT, notesT, 12, { pinned: ['p'] });
  const b = E.effortBreakdown(cfgT, notesT, r.notes, { pinned: ['p'] });
  // a 12 → 15 (+3, ×2 → 6/6 = +1) · b 12 → 14,5 (+2,5, ×1 → +0,4167) · p sabit 8 → 8
  assert.deepEqual(b.rows.map((x) => x.subjectId), ['a', 'b', 'p']);
  const [a, bb, p] = b.rows;
  assert.deepEqual([a.before, a.after, a.delta, a.pinned], [12, 15, 3, false]);
  assert.ok(Math.abs(a.gain - 1) < 1e-12);
  assert.deepEqual([bb.before, bb.after, bb.delta], [12, 14.5, 2.5]);
  assert.ok(Math.abs(bb.gain - 2.5 / 6) < 1e-12);
  assert.deepEqual([p.before, p.after, p.delta, p.gain, p.pinned], [8, 8, 0, 0, true]);
  // katkılar toplamı = genel ortalamadaki artış; kilitli ders satır değildir
  assert.ok(Math.abs(b.rows.reduce((s, x) => s + x.gain, 0) - (b.rawAfter - b.rawBefore)) < 1e-12);
  assert.equal(b.finalAfter, r.final);
  // eksik not: satır kalır, fark ve katkı null, sabitlerin önünde sona yakın
  const m = E.effortBreakdown(cfgT, { L: 10, a: 12, p: 8 }, { L: 10, a: 14, p: 8 });
  assert.deepEqual(m.rows.map((x) => [x.subjectId, x.delta]), [['a', 2], ['p', 0], ['b', null]]);
});

test('requiredTermNote: her derse / tek derse N not, notsuz zorunlu ders girer, opsiyonel girmez', () => {
  const cfgS = { subjects: [{ id: 'x', coef: 1 }, { id: 'y', coef: 1 }, { id: 'o', coef: 1, optional: true }] };
  const by = { x: [{ note: 10 }], y: [{ note: 14 }] }; // genel 12
  // her derse 1 not: (10+g)/2 + (14+g)/2 → 6 + g/2 ≥ 13,5 → g ≥ 15
  assert.ok(Math.abs(E.requiredTermNote(cfgS, by, 13.5) - 15) < 1e-6); // arama 1e-9 payıyla kabul eder
  // her derse 2 not: (24 + 4g)/6 ≥ 13 → g ≥ 13,5
  assert.ok(Math.abs(E.requiredTermNote(cfgS, by, 13, { count: 2 }) - 13.5) < 1e-6); // arama 1e-9 payıyla kabul eder
  // yalnız x: (10+g)/2 ≥ 13 → g ≥ 16
  assert.ok(Math.abs(E.requiredTermNote(cfgS, by, 13.5, { subjectId: 'x' }) - 16) < 1e-6); // arama 1e-9 payıyla kabul eder
  assert.equal(E.requiredTermNote(cfgS, by, 16, { subjectId: 'x' }), 'unreachable');
  assert.equal(E.requiredTermNote(cfgS, by, 8, { subjectId: 'y' }), 'safe'); // y'ye 0 → (10 + 7)/2 = 8,5
  assert.throws(() => E.requiredTermNote(cfgS, by, 12, { subjectId: 'yok' }));
  // notu olan opsiyonel ders hedefe katılır: o = [20] → (10+g)/2 + (14+g)/2 + (20+g)/2 → (44 + 3g)/6 ≥ 14 → g ≥ 40/3
  assert.ok(Math.abs(E.requiredTermNote(cfgS, { ...by, o: [{ note: 20 }] }, 14) - 40 / 3) < 1e-6); // arama 1e-9 payıyla kabul eder
  // notu olmayan zorunlu ders: z = g → ((10+g)/2 + (14+g)/2 + g)/3 = (12 + 2g)/3 ≥ 13 → g ≥ 13,5
  const cfgZ = { subjects: [...cfgS.subjects, { id: 'z', coef: 1 }] };
  assert.ok(Math.abs(E.requiredTermNote(cfgZ, by, 13) - 13.5) < 1e-6); // arama 1e-9 payıyla kabul eder
  // girdi değişmez
  assert.deepEqual(by, { x: [{ note: 10 }], y: [{ note: 14 }] });
});

test('overallCheck: Pronote genel ortalaması ↔ simülatör (okul katsayısı sınaması)', () => {
  const T = E.termAverage(cfgSec, E.gradesBySubject(exB.grades, { period: 1, defaultPeriod: exB.period.index }));
  const base = { ...exB, pronoteOverall: { period: 1, value: T.general } };
  const m = E.overallCheck(cfgSec, base);
  assert.equal(m.status, 'match');
  assert.equal(m.delta, 0);
  assert.equal(m.mandatory, cfgSec.subjects.filter((s) => !s.optional).length);
  assert.equal(m.tested, T.subjects.filter((s) => s.average != null).length);
  assert.ok(m.testedMandatory <= m.mandatory);
  // Pronote iki ondalık (yuvarlama/kesme) → 0,01 tolerans; 0,02 uyuşmazlık
  assert.equal(E.overallCheck(cfgSec, { ...base, pronoteOverall: { period: 1, value: T.general + 0.01 } }).status, 'match');
  const mm = E.overallCheck(cfgSec, { ...base, pronoteOverall: { period: 1, value: T.general + 0.5 } });
  assert.equal(mm.status, 'mismatch');
  assert.equal(mm.delta, -0.5);
  assert.equal(E.overallCheck(cfgSec, { ...base, pronoteOverall: { period: 1, value: T.general - 0.02 } }).status, 'mismatch');
  // veri yok · dönemde not yok
  assert.equal(E.overallCheck(cfgSec, { ...exB, pronoteOverall: undefined }).status, 'none');
  assert.equal(E.overallCheck(cfgSec, { ...base, pronoteOverall: { period: 3, value: 12 } }).status, 'none');
  // katsayı farkı yakalanır: bir dersin katsayısı 3 olursa genel değişir → uyuşmazlık
  const heavy = { ...cfgSec, subjects: cfgSec.subjects.map((s) => (s.id === 'maths' ? { ...s, coef: 3 } : s)) };
  assert.equal(E.overallCheck(heavy, base).status, 'mismatch');
});

test('yardımcılar: round2, snapToStep, ceilToStep, noteOn20', () => {
  assert.equal(E.round2(12.345), 12.35);
  assert.equal(E.round2(null), null);
  assert.equal(E.snapToStep(12.3), 12.25);
  assert.equal(E.ceilToStep(12.26), 12.5);
  assert.equal(E.ceilToStep(12.25), 12.25);
  assert.equal(E.noteOn20(15, 30), 10);
  assert.equal(E.noteOn20(null), null);
});
