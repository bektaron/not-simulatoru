import { boot, el, fmtDateTime, initTheme, Mode, unlockBox, webKeyStore, $ } from './ui.js';

initTheme($('#theme'));

const statusBox = $('#status');

function statusCard(result, page, label) {
  const mode = result ? result.mode : Mode.ERROR;
  const rec = mode === Mode.LOCAL || mode === Mode.WEB;
  const tone = rec && !result.stale ? 'good' : mode === Mode.LOCKED ? 'acc' : rec || mode === Mode.MISSING ? 'warn' : 'bad';
  const modeText = {
    [Mode.LOCAL]: result && result.stale ? 'Kayıt (7+ gün eski)' : 'Kayıt güncel',
    [Mode.WEB]: result && result.stale ? 'Kayıt (7+ gün eski)' : 'Kayıt güncel',
    [Mode.LOCKED]: 'Şifreli',
    [Mode.MISSING]: 'Kayıt yok',
    [Mode.INVALID_DATA]: 'Kayıt şemaya uymuyor',
    [Mode.ERROR]: 'Okunamadı',
  }[mode] || mode;
  return el('div', { class: 'sheet' },
    el('div', { class: 'eyebrow', text: label }),
    el('div', { class: 'mid', text: result && result.data ? result.data.displayName : '–' }),
    el('span', { class: `pill ${tone}`, text: modeText }),
    el('p', { class: 'sub mt', text: result && result.updatedAt ? `Son güncelleme: ${fmtDateTime(result.updatedAt)}` : (result ? result.message : '') }),
    el('p', { class: 'mt' }, el('a', { class: 'btn small', href: page, text: 'Aç' })),
  );
}

async function main() {
  let ctx;
  try {
    ctx = await boot({ student: null, configs: { A: 'config/bac-2027.json', B: 'config/seconde-2026.json' }, validateWith: { A: 'A', B: 'B' } });
  } catch {
    statusBox.append(el('div', { class: 'banner error' }, el('span', { class: 'label', text: 'Sorun' }), el('span', { text: 'Yapılandırma dosyaları yüklenemedi. Sayfa yerel sunucudan açılmalı (file:// çalışmaz).' })));
    return;
  }
  const { client } = ctx;
  async function show() {
    const [a, b] = await Promise.all([client.load('A'), client.load('B')]);
    statusBox.textContent = '';
    if ([a, b].some((r) => r.mode === Mode.LOCKED)) {
      const msg = [a, b].find((r) => r.mode === Mode.LOCKED).message;
      statusBox.append(el('div', { class: 'sheet' }, el('h2', { text: 'Notlar şifreli' }),
        unlockBox({ message: msg, onUnlock: async (pw, rem) => { const ok = await client.unlock(pw, { remember: rem }); if (ok) await show(); return ok; } })));
    }
    statusBox.append(statusCard(a, 'a-terminale.html', 'Öğrenci A — Terminale'), statusCard(b, 'b-seconde.html', 'Öğrenci B — Seconde'));
    // ortak cihazda şifre anahtarı silinebilsin (şifrenin kendisi zaten saklanmaz)
    if (client.source === 'web' && [a, b].some((r) => r.mode === Mode.WEB)) {
      statusBox.append(el('p', { class: 'sub' }, el('button', { type: 'button', class: 'btn small', text: 'Bu cihazda şifreyi unut', onclick: () => { webKeyStore.clear(); show(); } })));
    }
  }
  await show();
}

main();
