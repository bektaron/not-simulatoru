import { E, Mode, boot, el, fmt, fmt1, fmtDate, fmtNote, fmtSigned, renderBanner, renderEmptyState, buildGauge, setPill, noteRow, segButtons, sessionState, initTheme, initPrint, $ } from './ui.js';

initTheme($('#theme'));
initPrint($('#pdfBtn'));

const SCENARIOS = [
  { id: 'guncel', label: 'Güncel (Pronote)' }, // gerçekçi + notu olan derste bu yılın Pronote ortalaması
  { id: 'kotu', label: 'Kötü gidiş' },
  { id: 'gercekci', label: 'Gerçekçi (1ère eğilimi)' },
  { id: 'hedef', label: 'Hedef' },
];
const GENERIC_NOTES = [
  'Katsayılar: kontrol continu 40 + sınavlar 60 = 100 (okul sunumu; resmî metinle teyitli — arrêté 16-7-2018, 10-6-2025 değişikliği). Takip edilen LVC her yıl için +2 katsayı ekler ve sayılması zorunludur.',
  'Kontrol continu notu = yılın dönem ortalamalarının ortalaması (S1 ve S2 eşit), bir üst onda bire yuvarlanır (12,31 → 12,4). EPS = CCF 3 sınav ortalaması, en yakın tam puana yuvarlanır. Sınav notları tam puandır.',
  'Eşikler: 10 bac · 12 Assez bien · 14 Bien · 16 Très bien · 18 Très bien + félicitations du jury; mention yalnız birinci grupta. 8–10 arası ikinci grup (rattrapage): en çok 2 yazılı sınav sözlüde tekrarlanır, iyi olan not sayılır. Gösterilen ortalama iki ondalıkta aşağı kesilir; eşik karşılaştırması yuvarlanmamış değerle yapılır.',
  'Parcoursup bu hesaptan ayrıdır: dosyaya 1ère karneleri + Terminale 1. dönem karnesi + öğretmen yorumları gider.',
];

function pick(notes, subjects) {
  const out = {};
  for (const s of subjects) if (E.isNote(notes[s.id])) out[s.id] = notes[s.id];
  return out;
}

async function main() {
  let ctx;
  try {
    ctx = await boot({ student: 'A', configs: { bac: 'config/bac-2027.json' }, validateWith: 'bac' });
  } catch {
    const b = $('#banner'); b.classList.remove('hidden'); b.className = 'banner error';
    b.append(el('span', { class: 'label', text: 'Sorun' }), el('span', { text: 'Yapılandırma yüklenemedi. Sayfa bir HTTP sunucusundan açılmalı (file:// çalışmaz).' }));
    return;
  }
  const { client, configs } = ctx;
  render(ctx.result);

  function render(result) {
    const banner = $('#banner');
    banner.classList.remove('hidden');
    renderBanner(banner, result);
    const main = $('#main');
    const empty = $('#empty');
    if (!result || !result.data) {
      main.classList.add('hidden');
      empty.classList.remove('hidden');
      renderEmptyState(empty, result, {
        onDemo: async () => render(await client.loadDemo('A')),
        onUnlock: async (pw, rem) => { const ok = await client.unlock(pw, { remember: rem }); if (ok) render(await client.load('A')); return ok; },
      });
      return;
    }
    empty.classList.add('hidden');
    main.classList.remove('hidden');
    buildPage(result.data, result.mode === Mode.DEMO);
  }

  function buildPage(data, isDemo) {
    const session = sessionState('ds:v1:session:A', {});
    const base = E.withLabels(configs.bac, data.subjectLabels);
    const lockedFromFile = E.lockedToNotes(data.locked);
    const lockedSources = [...new Set((data.locked || []).map((l) => l.source).filter(Boolean))];
    const resolved = E.resolveOptions(base, data, session.get().options || {});
    const state = {
      options: resolved.options,
      lockedEdits: { ...(session.get().lockedEdits || {}) },
      scenario: session.get().scenario || 'guncel',
      var: {},
      estimated: new Set(),
      current: new Set(), // 'güncel' senaryoda Pronote ortalamasından gelen dersler
      counts: {},
      avgs: {}, // ders başına bu yılın Pronote ortalaması (etikette, yuvarlanmamış)
      source: 'file',
      periods: {},
      effort: null, // hedef ayarı sonrası emek dökümü (renderLever)
      target: session.get().target || 14,
      // hedef dağıtımında sabit dersler: varsayılan veri dosyasının `pinned` listesi (ör. zayıf ders), oturumda değişir
      pinned: new Set(Array.isArray(session.get().pinned) ? session.get().pinned : (Array.isArray(data.pinned) ? data.pinned : [])),
    };
    let cfg = E.withOptions(base, state.options);
    const labelOf = (id) => { const s = cfg.subjects.find((x) => x.id === id); return s ? s.label : id; };
    const lockedNotes = () => ({ ...lockedFromFile, ...state.lockedEdits });

    /* başlık */
    $('#title').textContent = `${data.displayName} — Bac Simülatörü`;
    $('#lead').textContent = `Kalan derslerdeki notları değiştir, bac genel ortalamasının ve mention'ın nasıl oynadığını gör. Katsayılar okulun Ekim 2026 veli toplantısı slaytlarından (resmî metinle teyitli); 1ère notları ${lockedSources.length ? lockedSources.join(', ') : 'veri dosyasından'}.${isDemo ? ' Şu an ÖRNEK veri gösteriliyor.' : ''}`;

    /* gösterge */
    const gauge = buildGauge($('#gauge'), { min: cfg.gauge?.min ?? 6, max: cfg.gauge?.max ?? 20, mentions: cfg.mentions });

    /* defter satırları (temel, kilitsiz dersler) */
    const ledger = $('#ledger');
    ledger.textContent = '';
    const rows = {};
    const gTot = E.groupTotals(base);
    for (const g of (base.groups || []).filter((x) => !x.locked)) {
      const subjects = base.subjects.filter((s) => s.group === g.id && !s.locked);
      if (!subjects.length) continue;
      ledger.append(el('div', { class: 'grp' }, el('span', { class: 'eyebrow', text: g.label }), el('span', { class: 'sub num', text: `${gTot[g.id] || 0} katsayı` })));
      for (const s of subjects) {
        rows[s.id] = noteRow({ id: s.id, name: s.label, hint: s.hint, coef: s.coef, value: 10, step: E.inputStep(s, cfg.scale?.step ?? 0.25), onInput: (v) => onEdit(s.id, v) });
        ledger.append(rows[s.id].el);
      }
    }

    /* opsiyon (LVC): 1ère kısmı kilitli notu varsa zorunlu olarak sayılır (resolveOptions), Tle kısmı kutuyla */
    const opt = (base.options || []).find((o) => (o.subjects || []).some((s) => !s.locked));
    const opt1 = (base.options || []).find((o) => o !== opt && (o.subjects || []).length && o.subjects.every((s) => s.locked));
    const optWrap = $('#optWrap');
    const optBox = $('#optLvc');
    const lvcRowWrap = $('#lvcRow');
    let lvcRow = null;
    if (opt) {
      const lvc1 = opt1 ? opt1.subjects[0] : opt.subjects.find((s) => s.locked);
      const lvcT = opt.subjects.find((s) => !s.locked);
      const lab = $('#optLabel');
      lab.textContent = '';
      const forced1 = opt1 && resolved.forced.includes(opt1.id);
      const note1 = E.isNote(lockedFromFile[lvc1?.id])
        ? `1ère ${fmt(lockedFromFile[lvc1.id])} ×${lvc1.coef}${forced1 ? ' — her durumda sayılıyor' : ''}`
        : '1ère notu dosyada yok';
      lab.append(`Tle'de takip ediliyor: ${lvcT ? lvcT.label : opt.label} ×${lvcT?.coef ?? 2} (${note1})`,
        el('span', { class: 'tag', text: opt.verified ? 'teyitli' : 'teyitsiz' }), el('br'), el('span', { class: 'sub', text: opt.note || '' }));
      if (lvcT) {
        lvcRow = noteRow({ id: lvcT.id, name: lvcT.label, hint: lvcT.hint, coef: lvcT.coef, value: 10, step: E.inputStep(lvcT, cfg.scale?.step ?? 0.25), onInput: (v) => onEdit(lvcT.id, v) });
        lvcRowWrap.textContent = '';
        lvcRowWrap.append(lvcRow.el);
        rows[lvcT.id] = lvcRow;
      }
      optBox.checked = !!state.options[opt.id];
      lvcRowWrap.hidden = !optBox.checked;
      optBox.addEventListener('change', () => {
        state.options = { ...state.options, [opt.id]: optBox.checked };
        session.patch({ options: state.options });
        cfg = E.withOptions(base, state.options);
        lvcRowWrap.hidden = !optBox.checked;
        clearResult();
        renderPins();
        if (optBox.checked && lvcT && !E.isNote(state.var[lvcT.id])) {
          const built = E.buildBacNotes(cfg, data, state.scenario === 'custom' ? 'guncel' : state.scenario);
          state.var[lvcT.id] = built.notes[lvcT.id];
          if (built.estimated.includes(lvcT.id)) state.estimated.add(lvcT.id);
          lvcRow.set(state.var[lvcT.id]);
        }
        calc();
      });
    } else {
      optWrap.hidden = true;
    }

    /* kilitli notlar */
    const lockedBox = $('#locked');
    lockedBox.textContent = '';
    const lockedInputs = {};
    for (const s of base.subjects.filter((x) => x.locked)) {
      const inp = el('input', { type: 'number', id: `l-${s.id}`, min: 0, max: 20, step: 0.05, inputmode: 'decimal' });
      inp.value = E.isNote(lockedNotes()[s.id]) ? String(lockedNotes()[s.id]) : '';
      inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        if (!Number.isFinite(v)) return;
        state.lockedEdits[s.id] = E.clamp(v, 0, 20);
        session.patch({ lockedEdits: state.lockedEdits });
        $('#lockedResetWrap').classList.remove('hidden');
        clearResult();
        calc();
      });
      lockedInputs[s.id] = inp;
      lockedBox.append(el('label', { for: `l-${s.id}` }, el('span', {}, s.label, ' ', el('small', { class: 'num', text: `×${s.coef}` })), inp));
    }
    $('#lockedResetWrap').classList.toggle('hidden', Object.keys(state.lockedEdits).length === 0);
    $('#lockedReset').onclick = () => {
      state.lockedEdits = {};
      session.patch({ lockedEdits: {} });
      for (const [id, inp] of Object.entries(lockedInputs)) inp.value = E.isNote(lockedFromFile[id]) ? String(lockedFromFile[id]) : '';
      $('#lockedResetWrap').classList.add('hidden');
      clearResult();
      calc();
    };
    const missingLocked = base.subjects.filter((s) => s.locked && !E.isNote(lockedFromFile[s.id]));
    $('#lockedNote').textContent = (missingLocked.length
      ? `Dosyada notu olmayan kilitli dersler: ${missingLocked.map((s) => s.label).join(', ')} (hesaba girmez). `
      : '') + 'Resmî notlar; değiştirilebilir ama değişmez — yalnız denetim için açık. Değişiklikler sekme kapanınca silinir.';

    /* hedef: kaydırıcı (10–20, 0,1 adım) + sayı kutusu + eşik kısayolları */
    const tRange = $('#tRange');
    const tNum = $('#tNum');
    const clampTarget = (v) => E.clamp(Math.round(v * 10) / 10, 10, 20);
    state.target = clampTarget(Number(state.target) || 14);
    const targets = cfg.mentions.filter((m) => ['assez-bien', 'bien', 'tres-bien'].includes(m.level));
    const segT = segButtons($('#segT'), targets.map((t) => ({ id: String(t.min), label: `${t.short || t.label} (${t.min})` })), String(state.target), (id) => setTarget(Number(id)));
    tRange.value = String(state.target);
    tNum.value = String(state.target);
    function setTarget(v, from) {
      if (!Number.isFinite(v)) return;
      state.target = clampTarget(v);
      if (from !== 'range') tRange.value = String(state.target);
      if (from !== 'num') tNum.value = String(state.target);
      segT.set(String(state.target));
      session.patch({ target: state.target });
      clearResult();
      calc();
    }
    tRange.addEventListener('input', () => setTarget(parseFloat(tRange.value), 'range'));
    tNum.addEventListener('input', () => { const v = parseFloat(tNum.value); if (v >= 10 && v <= 20) setTarget(v, 'num'); });
    tNum.addEventListener('change', () => { tNum.value = String(state.target); });

    /* dağıtımda sabit tutulan dersler */
    function renderPins() {
      const box = $('#pins');
      box.textContent = '';
      for (const s of cfg.subjects.filter((x) => !x.locked)) {
        box.append(el('button', {
          type: 'button', class: 'btn', 'aria-pressed': String(state.pinned.has(s.id)), text: s.label,
          onclick: () => {
            if (state.pinned.has(s.id)) state.pinned.delete(s.id); else state.pinned.add(s.id);
            session.patch({ pinned: [...state.pinned] });
            clearResult();
            renderPins();
            syncRows();
            calc();
          },
        }));
      }
    }
    const pinnedNow = () => cfg.subjects.filter((s) => !s.locked && state.pinned.has(s.id));
    // hedef ayarı sonrası "Emek nereye?" dökümü; ekrandaki notlar ya da hedef değişince bayatlar → genel görünüme dönülür
    function clearResult() { $('#tResult').textContent = ''; state.effort = null; }
    $('#leverBack').addEventListener('click', () => { state.effort = null; calc(); });

    /* notları hedefe göre ayarla: sabit olmayan derslere en küçük ortak kaydırma */
    $('#tApply').addEventListener('click', () => {
      const before = { ...lockedNotes(), ...state.var };
      const r = E.distributeToTarget(cfg, before, state.target, { pinned: [...state.pinned], defaultStep: cfg.scale?.step ?? 0.25 });
      const pins = pinnedNow().map((s) => `${s.label} ${fmt(before[s.id])}`).join(', ') || 'yok';
      if (!r.reachable) {
        $('#tResult').textContent = r.free.length
          ? `Ulaşılamaz: sabit dersler (${pins}) bu notlarda kalırsa, diğerlerinin hepsi 20 olsa bile en çok ${fmt(E.floor2(r.best))}.`
          : 'Dağıtılacak ders yok — en az bir dersin sabitini kaldırın.';
        return;
      }
      for (const id of r.free) state.var[id] = r.notes[id];
      state.scenario = 'custom';
      seg.clear();
      customNote.textContent = 'Özel — hedefe göre ayarlandı';
      customNote.hidden = false;
      session.patch({ scenario: 'custom', custom: state.var });
      state.effort = { target: state.target, pins: pinnedNow().map((s) => s.label), ...E.effortBreakdown(cfg, before, r.notes, { pinned: [...state.pinned] }) };
      syncRows();
      calc();
      $('#tResult').textContent = `Sabit olmayan dersler ${fmtSigned(Math.abs(r.delta) < 0.005 ? 0 : r.delta)} puan kaydırıldı (sınavlar tam puana, kontrol continu bir üst onda bire yuvarlandı) → ${fmt(r.final)} · sabit: ${pins}.`;
    });

    /* senaryolar */
    const customNote = el('span', { class: 'sub', text: 'Özel — elle değiştirildi', hidden: true });
    const seg = segButtons($('#scen'), SCENARIOS, state.scenario, (id) => applyScenario(id));
    $('#scen').append(customNote);

    function syncRows() {
      for (const [id, r] of Object.entries(rows)) if (E.isNote(state.var[id])) r.set(state.var[id]);
      for (const [id, r] of Object.entries(rows)) {
        const tag = r.el.querySelector('.tag.est');
        if (state.estimated.has(id) && !tag) r.el.querySelector('.name').insertBefore(el('span', { class: 'tag est', text: 'tahmin' }), r.el.querySelector('.name small'));
        if (!state.estimated.has(id) && tag) tag.remove();
        const cur = r.el.querySelector('.tag.cur');
        const curText = `güncel · ${state.counts[id] || 0} not${E.isNote(state.avgs[id]) ? ` · ort. ${fmt(state.avgs[id])}` : ''}`;
        if (state.current.has(id) && !cur) r.el.querySelector('.name').insertBefore(el('span', { class: 'tag cur', text: curText, title: 'Bu yılın Pronote ortalaması (dönem ortalamalarının ortalaması)' }), r.el.querySelector('.name small'));
        else if (state.current.has(id) && cur) cur.textContent = curText;
        if (!state.current.has(id) && cur) cur.remove();
        const pin = r.el.querySelector('.tag.pin');
        if (state.pinned.has(id) && !pin) r.el.querySelector('.name').insertBefore(el('span', { class: 'tag pin', text: 'sabit' }), r.el.querySelector('.name small'));
        if (!state.pinned.has(id) && pin) pin.remove();
      }
    }
    function describeSource() {
      if (state.source === 'current') {
        const cur = [...state.current].map((id) => `${labelOf(id)} (${state.counts[id] || 0})`).join(', ');
        $('#scenSource').textContent = `Kaynak: "güncel" etiketli derslerde bu yılın Pronote ortalaması — ${cur || 'henüz not yok'}; `
          + `"tahmin" etiketlilerde henüz not yok, gerçekçi senaryonun tahmini duruyor. Az notla ortalama oynaktır; sınav dersleri tam puana yuvarlanır.`;
        return;
      }
      const src = state.source === 'file' ? 'veri dosyasındaki senaryo' : state.source === 'derived' ? 'dosyada senaryo yok; ders ortalamalarından türetildi' : 'veri dosyası + ders ortalamalarından tamamlandı';
      const est = state.estimated.size ? ` · "tahmin" etiketli dersler için henüz not yok (${[...state.estimated].map(labelOf).join(', ')}).` : '';
      const nP = Math.max(0, ...Object.values(state.periods || {}));
      const per = state.source !== 'file' && nP > 0
        ? ` · türetilen notlar ${nP === 1 ? 'yalnız ilk dönemden tahmin (yıllık not = dönem ortalamalarının ortalaması)' : `${nP} dönemin ortalamasından`}.`
        : '';
      $('#scenSource').textContent = `Kaynak: ${src}${est}${per}`;
    }
    function applyScenario(name) {
      const built = E.buildBacNotes(cfg, data, name);
      state.var = pick(built.notes, cfg.subjects.filter((s) => !s.locked));
      state.estimated = new Set(built.estimated);
      state.current = new Set(built.current || []);
      state.counts = built.counts || {};
      state.avgs = built.current ? built.averages || {} : {};
      state.source = built.source;
      state.periods = built.periods;
      state.scenario = name;
      session.patch({ scenario: name, custom: null });
      seg.set(name);
      customNote.hidden = true;
      clearResult();
      syncRows();
      describeSource();
      calc();
    }
    function onEdit(id, v) {
      state.var[id] = v;
      state.scenario = 'custom';
      seg.clear();
      customNote.textContent = 'Özel — elle değiştirildi';
      customNote.hidden = false;
      session.patch({ scenario: 'custom', custom: state.var });
      clearResult();
      calc();
    }

    /* hesap */
    function calc() {
      const notes = { ...lockedNotes(), ...state.var };
      const T = E.finalBac(cfg, notes);
      $('#final').textContent = fmt(T.final);
      setPill($('#mention'), E.mention(T.raw, cfg));
      // şu ana kadarki notlarla (tahminler hariç): 1ère resmî + bu yıl notu olan dersler — senaryodan bağımsız
      const K = E.knownAverage(cfg, data, { locked: lockedNotes() });
      $('#knownAvg').textContent = !E.isNote(K.final) ? ''
        : K.currentCoef > 0 ? `Şu ana kadarki notlarla: ${fmt(K.final)} · ${K.coef}/${K.total} kats. (tahminler hariç)`
          : `Şu ana kadarki notlarla: ${fmt(K.final)} · yalnız 1ère (${K.coef}/${K.total} kats.)`;
      $('#lockedAvg').textContent = fmt(T.lockedAvg);
      $('#lockedCoef').textContent = `${T.lockedCoef} katsayı · ${fmt1(T.lockedSum)} puan`;
      $('#restAvg').textContent = fmt(T.restAvg);
      $('#restCoef').textContent = `${T.restCoef} katsayı · ${fmt1(T.restSum)} puan`;
      $('#restTitle').textContent = `Kalan ${T.restCoef} katsayı`;
      $('#lockedSummary').textContent = `1ère'den kilitli ${T.lockedCoef} katsayı${lockedSources.length ? ` (${lockedSources.join(', ')})` : ''}`;
      const nx = E.nextThreshold(T.raw, cfg, T.countedCoef);
      const lev = E.leverage(cfg);
      const top = lev.find((x) => !state.pinned.has(x.subjectId)) || lev[0]; // sabit ders öneri olmasın
      if (nx) {
        $('#nextGap').textContent = `+${fmt1(nx.gapWeighted)} puan`;
        $('#nextLabel').textContent = `${nx.short} (${nx.threshold}) için · ≈ +${fmt(nx.gapWeighted / top.coef)} ${top.label}'de`;
      } else {
        $('#nextGap').textContent = '—';
        $('#nextLabel').textContent = 'En üst eşik aşıldı';
      }
      gauge.update(T.raw);
      // puan hücresi resmî notla: kontrol continu ↑0,1, EPS tam puan (T.effective)
      for (const [id, r] of Object.entries(rows)) r.update(E.isNote(T.effective[id]) ? T.effective[id] : (E.isNote(state.var[id]) ? state.var[id] : r.value), { totalCoef: T.countedCoef });

      renderLever(T);

      /* hedef: sabit olmayan derslerde gereken ortalama */
      setPill($('#tMention'), E.mention(state.target, cfg));
      const free = cfg.subjects.filter((s) => !s.locked && !state.pinned.has(s.id));
      const freeCoef = free.reduce((a, s) => a + s.coef, 0);
      const freeNow = E.weightedAverage(free.map((s) => ({ note: E.isNote(T.effective[s.id]) ? T.effective[s.id] : null, coef: s.coef })));
      const need = E.requiredAverage(cfg, notes, state.target, { pinned: [...state.pinned] });
      const needBox = $('#tNeed').parentElement;
      const pinTxt = pinnedNow().map((s) => `${s.label} ${fmt(E.officialNote(s, notes[s.id]))}`).join(', ');
      const pinPart = pinTxt ? ` · sabit: ${pinTxt}` : '';
      needBox.className = 'need';
      if (need === null) {
        $('#tNeed').textContent = '—';
        $('#tNeedSub').textContent = 'Tüm dersler sabit; dağıtılacak ders yok.';
      } else if (need === 'unreachable') {
        needBox.classList.add('bad');
        $('#tNeed').textContent = 'ulaşılamaz';
        $('#tNeedSub').textContent = `${freeCoef} katsayıda 20'ler bile yetmez${pinPart}`;
      } else if (need === 'safe') {
        needBox.classList.add('good');
        $('#tNeed').textContent = 'zaten güvende';
        $('#tNeedSub').textContent = `kilitli${pinTxt ? ' ve sabit' : ''} notlar hedefi tek başına taşıyor`;
      } else {
        if (E.isNote(freeNow) && need <= freeNow + 1e-9) needBox.classList.add('good');
        $('#tNeed').textContent = `≈ ${fmt(need)}`;
        $('#tNeedSub').textContent = `${free.length} ders · ${freeCoef} katsayı · şu an ${fmt(freeNow)}${E.isNote(freeNow) ? ` (${fmtSigned(need - freeNow)})` : ''}${pinPart}`;
      }

      const sv = $('#solve');
      sv.textContent = '';
      const order = cfg.subjects.filter((s) => !s.locked).sort((a, b) => (a.group === 'exam-tle' ? 0 : 1) - (b.group === 'exam-tle' ? 0 : 1) || b.coef - a.coef);
      for (const s of order) {
        const cur = notes[s.id];
        const need = E.requiredNote(cfg, notes, s.id, state.target);
        let txt, cls;
        if (need === 'unreachable') { txt = 'ulaşılamaz'; cls = 'bad'; }
        else if (need === 'safe') { txt = 'zaten güvende'; cls = 'good'; }
        else { const n = E.ceilToStep(need, E.inputStep(s, cfg.scale?.step ?? 0.25)); txt = fmt(n); cls = n > E.officialNote(s, cur) ? 'warn' : 'good'; }
        sv.append(el('tr', {}, el('td', { text: s.label }), el('td', { class: 'r', text: fmt(cur) }), el('td', { class: `r ${cls}`, text: txt })));
      }
      if (T.missing.length) $('#scenSource').append(el('span', { class: 'tag', text: `${T.missing.length} not eksik` }));
    }

    /* "Emek nereye?": genel görünüm = +1 puanın katkısı (katsayı); hedef ayarlanınca mor hedef görünümü =
       her derste notun ne kadar artacağı ("emek") ve genele katkısı, sabit dersler emeksiz en altta */
    const LEVER_SUB = $('#leverSub').textContent;
    const fmtS = (n) => (E.isNote(n) ? String(Math.round(n * 100) / 100).replace('.', ',') : '–');
    const fmtSS = (n) => (E.isNote(n) ? (n >= 0 ? '+' : '−') + fmtS(Math.abs(n)) : '–');
    const ths = (...h) => el('tr', {}, h.map(([t, r]) => el('th', { class: r ? 'r' : null, text: t })));
    function renderLever(T) {
      const ef = state.effort;
      const lv = $('#lever');
      const head = $('#leverHead');
      const foot = $('#leverFoot');
      lv.textContent = ''; head.textContent = ''; foot.textContent = '';
      $('#leverBox').classList.toggle('tgt', !!ef);
      $('#leverTag').classList.toggle('hidden', !ef);
      $('#leverBackWrap').classList.toggle('hidden', !ef);
      if (!ef) {
        $('#leverSub').textContent = LEVER_SUB;
        head.append(ths(['Ders'], ['Kats.', 1], ['+1 puan', 1], ['']));
        const items = E.leverage(cfg);
        const maxCoef = items.length ? items[0].coef : 1;
        for (const it of items) {
          const bar = el('span', { class: 'lev' }); bar.style.width = `${(it.coef / maxCoef) * 100}%`;
          lv.append(el('tr', {}, el('td', { text: it.label }), el('td', { class: 'r', text: String(it.coef) }), el('td', { class: 'r', text: `+${fmt(it.coef / T.countedCoef)}` }), el('td', { class: 'lev-cell' }, bar)));
        }
        return;
      }
      $('#leverTag').textContent = `hedef ${fmt(ef.target)}`;
      $('#leverSub').textContent = `Hedef ${fmt(ef.target)} için her derste notun ne kadar değişmesi gerektiği (emek) ve genel ortalamaya katkısı. `
        + (ef.pins.length ? `Sabit tutulan ${ef.pins.join(', ')} emek almaz; yük diğer derslere dağıldı.` : 'Sabit ders yok; yük bütün derslere dağıldı.');
      head.append(ths(['Ders'], ['Kats.', 1], ['Not', 1], ['Emek', 1], ['Genele', 1]));
      const maxGain = Math.max(0, ...ef.rows.filter((r) => !r.pinned && E.isNote(r.gain)).map((r) => r.gain));
      for (const r of ef.rows) {
        const name = el('td', {}, r.label, r.pinned ? el('span', { class: 'tag pin', text: 'sabit' }) : null);
        if (r.pinned) {
          lv.append(el('tr', { class: 'pinned' }, name, el('td', { class: 'r', text: String(r.coef) }), el('td', { class: 'r', text: fmtS(r.before) }), el('td', { class: 'r', text: '—' }), el('td', { class: 'r', text: '—' })));
          continue;
        }
        const dir = E.isNote(r.delta) && r.delta > 0 ? 'up' : E.isNote(r.delta) && r.delta < 0 ? 'down' : '';
        const gain = el('td', { class: `r ${dir}` }, E.isNote(r.gain) ? fmtSigned(r.gain) : '–');
        if (dir === 'up' && maxGain > 0) { const bar = el('span', { class: 'lev' }); bar.style.width = `${(r.gain / maxGain) * 100}%`; gain.append(bar); }
        lv.append(el('tr', {}, name, el('td', { class: 'r', text: String(r.coef) }),
          el('td', { class: 'r', text: `${fmtS(r.before)} → ${fmtS(r.after)}` }),
          el('td', { class: `r ${dir}`, text: dir ? fmtSS(r.delta) : '0' }), gain));
      }
      foot.append(el('tr', {}, el('td', { colspan: 5, text: `Genel ortalama ${fmt(ef.finalBefore)} → ${fmt(ef.finalAfter)} (${fmtSigned(ef.rawAfter - ef.rawBefore)})` })));
    }

    /* bu dönemin notları (yalnız içinde bulunulan dönem; S2 gelince S1 karışmasın) */
    const by = E.gradesBySubject(data.grades, data.period ? { period: data.period.index, defaultPeriod: data.period.index } : {});
    const gradesBox = $('#grades');
    gradesBox.textContent = '';
    const periodText = data.period ? `${data.period.index}. ${data.period.type}` : 'dönem';
    const gradeCount = (data.grades || []).length;
    $('#gradesTitle').textContent = `Bu dönemin notları — ${periodText}`;
    $('#gradesSub').textContent = gradeCount ? `${gradeCount} not · ders ortalaması Pronote kuralıyla (/20; bonus ve isteğe bağlı notlar dahil).` : 'Bu dönem için henüz not yok.';
    for (const s of cfg.subjects) {
      const list = by[s.id];
      if (!list) continue;
      const avg = E.pronoteAverage(list);
      const tbody = el('tbody');
      for (const g of [...list].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
        tbody.append(el('tr', {},
          el('td', { class: 'num', text: fmtDate(g.date) }), el('td', { text: g.label || '' }),
          el('td', { class: 'r', text: fmtNote(g) }), el('td', { class: 'r', text: E.isNote(g.coef) ? String(g.coef) : '1' }),
          el('td', { class: 'r', text: E.isNote(g.classAvg) ? fmt(g.classAvg) : '–' })));
      }
      gradesBox.append(el('article', { class: 'card' },
        el('header', {}, el('h3', { text: s.label }), el('span', { class: 'avg', text: fmt(avg) })),
        el('div', { class: 'tablebox' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Tarih' }), el('th', { text: 'Değerlendirme' }), el('th', { class: 'r', text: 'Not' }), el('th', { class: 'r', text: 'Kats.' }), el('th', { class: 'r', text: 'Sınıf' }))), tbody))));
    }
    const up = (data.upcoming || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    $('#upcomingWrap').classList.toggle('hidden', up.length === 0);
    const ul = $('#upcoming');
    ul.textContent = '';
    for (const u of up) ul.append(el('li', { text: `${fmtDate(u.date)} · ${labelOf(u.subjectId)}${u.label ? ` — ${u.label}` : ''}` }));

    /* okuma notları */
    const notesUl = $('#notes');
    notesUl.textContent = '';
    for (const n of [...(data.notes || []), ...GENERIC_NOTES]) notesUl.append(el('li', { text: n }));

    /* başlangıç */
    renderPins();
    if (state.scenario === 'custom' && session.get().custom) {
      const built = E.buildBacNotes(cfg, data, 'guncel');
      state.var = { ...pick(built.notes, cfg.subjects.filter((s) => !s.locked)), ...session.get().custom };
      state.estimated = new Set(built.estimated);
      state.current = new Set(built.current || []);
      state.counts = built.counts || {};
      state.avgs = built.averages || {};
      state.source = built.source;
      state.periods = built.periods;
      seg.clear();
      customNote.hidden = false;
      syncRows();
      describeSource();
      calc();
    } else {
      applyScenario(SCENARIOS.some((s) => s.id === state.scenario) ? state.scenario : 'guncel');
    }
  }
}

main();
