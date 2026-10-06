# Not Simülatörleri

İki öğrenci için not / bac simülatörü. **Hangi derste kaç puan, genel ortalamayı ve mention'ı nasıl değiştirir?** sorusunu canlı yanıtlar. Statik site, bağımlılıksız (vanilla HTML/CSS/JS); bilgisayarda yerel sunucudan, iPad'de GitHub Pages'ten (şifreli kayıtla) çalışır. **Not almaz, hiçbir yere bağlanmaz:** yalnız kendi kaydını (`data/` ya da şifreli `docs/web/`) okur ve simüle eder.

- **Öğrenci A — Terminale** (`docs/a-terminale.html`): bac 2027. Kilitli 1ère notları + Terminale senaryoları, 6–20 eşik göstergesi, "Emek nereye?", **"Hedefe ne lazım?"** (hedef kaydırıcısı · sabit dersler · "Notları hedefe göre ayarla" · tek başına gereken not), bu dönemin notları.
- **Öğrenci B — Seconde** (`docs/b-seconde.html`): trimestre ortalaması (geçici "ya şu sınavdan X alırsa" notlarıyla) + **trimestre hedefi** (her derste / tek derste sonraki N not kaç olmalı) + bac 2029 projeksiyonu (üç spécialité, üç "bırakma" senaryosu yan yana).

## Kullanım

1. **MyTaskBar → Notlar sekmesi → "Simülatör — …" satırı** (sağ tıkla da açılır): gömülü pencere, kendi yerel sunucusunu (`127.0.0.1`, boş port) başlatır; açılışta veri Pronote kaydından tazelenir. Varsayılan yol budur.
2. Ayrıca bu klasördeki `Not-Simulatoru.bat` ya da `npm run serve` → `http://localhost:8081/` (`docs/`'a yönlenir). Sayfalar `file://` ile açılmaz, sunucu şart.
3. Gerçek notlar `data/a.json` · `data/b.json`: **yalnız MyTaskBar yazar** (`MyTaskBar/mtb/notsim.py` — her başarılı Pronote yenilemesinden sonra ve pencere açılırken; Pronote notları + sabit kayıt `MyTaskBar/kizlar/not-simulatoru-sabit.json`). Elle düzenlenmez, commit edilmez (`.gitignore`). Dosya varsa üstte **"Kayıt · Son güncelleme"** bandı çıkar; yoksa sayfa "Kayıt yok" der, örnek veri yalnız düğmeyle açılır.
4. Doğrulama: `npm run validate` (veya `node scripts/validate-data.mjs data/a.json`).
5. **PDF / yazdır:** üst çubuktaki **PDF** düğmesi `window.print()` çağırır — yazdırma stili açık renk, kapalı bölümler açık, en üstte çıktı damgası (başlık · sekme · tarih). MyTaskBar'ın gömülü penceresinde istek yakalanır ve doğrudan `Coding\outputs\reports\yymmdd_Kız_Sayfa.pdf` yazılır (`mtb/notsimweb.py`); tarayıcıda yazdırma penceresi açılır ("PDF olarak kaydet"). Sayfa kendisi dosya yazmaz.

## Bağlantı yok

- Kodda GitHub API, token, önbellek, harici yazı tipi veya CDN yoktur. Sayfaların CSP'si `connect-src 'self'`.
- `scripts/readonly-check.mjs` site kodunda dış adres (`http(s)://…`), yazma çağrısı (`PUT/POST/PATCH/DELETE`) veya yan kanal (XHR, WebSocket, beacon) görürse kırılır.
- Notları kaydeden taraf simülatör değildir; MyTaskBar Pronote'tan okur ve kayıt dosyasını yazar.

## Yapı

```
index.html                  → docs/ yönlendirmesi (yerel sunucu kökü)
data/                       a.json · b.json — gerçek notlar, git dışı (yerel kullanım)
docs/                       site (yerel sunucu kökü)
  index.html + index.js     giriş, kayıt durum kartları
  a-terminale.html/.js      Öğrenci A
  b-seconde.html/.js        Öğrenci B (iki sekme)
  engine.js                 hesap motoru — saf, DOM'suz, Node ile test edilir
  data.js                   veri katmanı — yerel kayıt (../data/) ya da şifreli web kaydı (web/); dış adres reddedilir
  crypto.js                 AES-256-GCM + PBKDF2 (WebCrypto) — tarayıcı ve yayın betiği ortak
  web/                      a.enc.json · b.enc.json — şifreli kayıt (yalnız yayın betiği yazar)
  validate.js               JSON Schema alt-küme doğrulayıcı + config çapraz kontrolü
  ui.js · styles.css        ortak bileşenler, açık/koyu tema
  config/                   bac-2027.json · seconde-2026.json · bac-2029.json  (data-source.json kullanılmıyor)
  schema/notes.schema.json  veri dosyası şeması (draft 2020-12)
  examples/                 a.example.json · b.example.json — UYDURMA, "example": true
tests/                      engine.test.mjs · data.test.mjs · web.test.mjs (node --test)
scripts/                    privacy-check.mjs · readonly-check.mjs · validate-data.mjs · web-sifre.mjs · web-yayin.mjs
  hooks/                    post-commit (commit → push) · pre-push (gizlilik denetimi)
.github/workflows/ci.yml    test + gizlilik grep'i (geçmiş + commit mesajları) + salt-okunur denetimi
```

## Çalıştırma

- **Yerel:** MyTaskBar'ın gömülü penceresi ya da `npm run serve` (→ http://localhost:8081/, `docs/`'a yönlenir). Sayfalar ES module + `fetch` kullanır; `file://` ile açılmaz.
- **Test ve denetimler:** `npm run check` (= `npm test` + gizlilik denetimi). Geçmiş dahil: `npm run privacy:history`. Salt-okunur denetimi: `node scripts/readonly-check.mjs`. Veri dosyası: `npm run validate`.

Gereksinim: Node ≥ 22. Bağımlılık yok.

## Web (iPad) — şifreli yayın

Sabit adres: **https://bektaron.github.io/not-simulatoru/** (GitHub Pages, `main` dalının `docs/` klasörü). Öğrenciler iPad'de açar, ilk seferde ortak şifreyi girer ("Bu cihazda hatırla" → bir daha sorulmaz). Ana ekrana eklenebilir.

- **Gizlilik:** depo herkese açıktır; notlar yalnız `docs/web/a.enc.json` · `b.enc.json` içinde, ortak şifreden türetilen anahtarla AES-256-GCM şifreli durur (PBKDF2-SHA256, 600 000 tur). Şifre tarayıcıda çözülür, hiçbir yere gönderilmez. iPad şifrenin kendisini değil türetilmiş anahtarı saklar; giriş sayfasında "Bu cihazda şifreyi unut". Şifresiz gelen yalnız kilit ekranını ve örnek (uydurma) veriyi görür. Kod, commit mesajları ve dosya adları isimsizdir (pre-push + CI denetler).
- **Kaynak seçimi:** sayfa `localhost`/`127.0.0.1`'den açılırsa yerel `data/`, başka her adreste şifreli `web/` okunur (`?web` yerelde de web kaynağını dener).
- **Şifre (bir kez, bilgisayarın kendi terminalinde):** `npm run web:sifre` — şifre iki kez gizli sorulur; yalnız türetilmiş anahtar `web-anahtar.local.json`'a yazılır (git dışı), ardından kayıtlar yeni anahtarla yayınlanır. Şifre değişince iPad'ler eskisini bırakıp yenisini sorar.
- **Şifresiz giriş — özel bağlantı:** `npm run web:baglanti` — anahtar yoksa rastgele üretip yayınlar; bağlantıyı (`…/#k=<anahtar>`) `web-baglanti.local.txt`'ye yazar (git dışı, ekrana basmaz). Bağlantıyı açan cihaz şifre yazmadan görür, anahtarı saklar; sayfa anahtarı adres çubuğundan siler. `#` sonrası sunucuya gitmez. Bağlantı = şifre: yalnız özelden iletilir. `web:sifre` ya da `web:baglanti --yeni` anahtarı değiştirir, eski bağlantılar geçersizleşir.
- **Notlar ne zaman gider:** MyTaskBar her başarılı Pronote yenilemesinden sonra `scripts/web-yayin.mjs`'i çağırır: notlar değiştiyse (ya da son yayın 20 saatten eskiyse) şifreler, yalnız `docs/web/`'i commit'ler. Şifre kurulmamışsa sessizce atlar.
- **Commit → web:** `npm run hooks` (bir kez; `core.hooksPath = scripts/hooks`). `main`'e her commit `post-commit` ile GitHub'a itilir, Pages birkaç dakikada yenilenir. `pre-push` itmeden önce gizlilik denetimini (dosyalar + itilecek commit mesajları) çalıştırır; bulgu ya da node yoksa itme durur.
- Pages dosyaları ~10 dk önbelleklenir: yayından hemen sonra eski sürüm görünebilir.

## Kayıt doğrulama

`npm run validate` (= `node scripts/validate-data.mjs data/a.json data/b.json`) — şema + config kontrolü.

## Veri dosyası şeması (özet)

```json
{
  "schemaVersion": 1, "student": "A", "displayName": "…", "track": "bac",
  "updatedAt": "2026-10-03T10:35:00+03:00", "source": "Pronote · elle okuma",
  "period": { "type": "semestre", "index": 1 },
  "locked":   [ { "id": "fr_e", "note": 12, "coef": 5, "source": "Cyclades 2026-07-03" } ],
  "grades":   [ { "date": "2026-09-21", "subjectId": "spe1", "label": "DS 1", "note": 14, "outOf": 20, "coef": 1, "classAvg": 11.2 } ],
  "upcoming": [ { "date": "2026-10-09", "subjectId": "spe1", "label": "DS 2" } ],
  "scenarios": { "kotu": { "spe1": 9 }, "gercekci": { "spe1": 12 }, "hedef": { "spe1": 15 } },
  "subjectLabels": { "spe1": "…", "spe2": "…", "spe_drop": "…", "lvb": "…" },
  "options": { "lvc": false },
  "pinned": [ "spe1" ],
  "pronoteOverall": { "period": 1, "value": 13.47 },
  "notes": [ "Okuma notu…" ]
}
```

**Senaryolar (A):** **Güncel (Pronote)** — varsayılan, ilk düğme: notu olan derste bu yılın Pronote ortalaması (dönem ortalamalarının ortalaması, dersin ızgarasına oturtulur; satırda "güncel · N not"), notu olmayanda gerçekçi senaryonun değeri ("tahmin") · Kötü gidiş · Gerçekçi (1ère eğilimi — dosyadaki elle girilmiş tahmin, Pronote'la değişmez) · Hedef.

Kurallar: `grades` ham Pronote notudur (`note`/`outOf`, not katsayısı, varsa sınıf ortalaması; `null` = Abs · Disp · N.Not; Abs\* ve N.Rdu\* `0` yazılır). Pronote bayrakları isteğe bağlı: `outOf20` ("Ramener sur 20"; `false` → puanlar baremle havuzlanır, yoksa `true` sayılır) · `bonus` (yalnız barem yarısının üstü eklenir) · `optional` (yalnız ortalamayı yükseltiyorsa sayılır). Ders ortalaması ve mention **dosyaya yazılmaz**, simülatör hesaplar. `locked` yalnız A'da. `scenarios` isteğe bağlı: yoksa "gerçekçi" ders ortalamalarından türetilir; "kötü/hedef" yoksa gerçekçi ∓ 2. `subjectLabels` genel yuva adlarının yerine görünen adı verir (gerçek spécialité adları yalnız private dosyada). `pinned` hedef dağıtımında varsayılan olarak sabit tutulan kilitsiz derslerdir (ör. zayıf olunan ders); sayfada oturum boyunca değiştirilebilir, kilitli ders yazılamaz. İkisi de sabit kayıttan (`MyTaskBar/kizlar/not-simulatoru-sabit.json`) gelir. `pronoteOverall` Pronote'un kendi genel ortalamasıdır (ham kaynak değeri, MyTaskBar yazar); B sayfası okul katsayılarını bununla sınar (`overallCheck`). `grades[].period` yoksa `period.index` sayılır (B'de trimestre karşılaştırması için). `track: "ib"` ise B'nin bac sekmesi gizlenir.

### Ders kimlikleri

**A — bac-2027** (ve bac-2029 aynı yapı)

| id | ders | kats. | durum |
|---|---|---|---|
| `fr_e` · `fr_o` · `ma_a` | Français écrit · oral · Maths anticipées | 5 · 5 · 2 | kilitli (1ère sınavları) |
| `hg1` · `lva1` · `lvb1` · `es1` · `emc1` | HG · LVA · LVB · Ens. sci. · EMC (1ère) | 3 · 3 · 3 · 3 · 1 | kilitli |
| `spe_drop` | bırakılan spécialité (1ère) | 8 | kilitli |
| `spe1` · `spe2` | spécialité 1 · 2 (Tle sınavı) | 16 · 16 | değişken |
| `philo` · `go` | Philosophie · Grand oral | 8 · 8 | değişken |
| `eps` · `hg` · `lva` · `lvb` · `es` · `emc` | Tle kontrol continu | 6 · 3 · 3 · 3 · 3 · 1 | değişken |
| `lvc1` · `lvc` | LVC opsiyonu (1ère · Tle) | 2 · 2 | teyitli; iki ayrı opsiyon (bac-2027): `lvc1` kilitli notu veride varsa **zorunlu açık**, `lvc` veri `options.lvc` ile; 100'e eklenir |

Toplam 100 = 33 kilitli + 67 değişken (config'ten okunur); LVC iki yıl → 104. Kaynak: okulun Ekim 2026 veli toplantısı sunumu, resmî metinle teyitli (O25 raporu: `Coding/outputs/reports/2026-10-06_not-simulatoru-resmi-kurallar.md`).

Ders başına config alanları: `step` (girdi adımı — sınav 1, EPS 1, kontrol continu 0,1) · `rounding` (resmî yuvarlama — `ceil-0.1`: kontrol continu yıllık ortalaması bir üst onda bire; `round-1`: EPS CCF ortalaması en yakın tam puana). Sınav notu tam puandır ama senaryodaki beklenti (ör. 11,5) yuvarlanmaz.

**B — seconde-2026**: `fr maths hg lva lvb ses snt pc svt eps emc` + opsiyon `lvc euro sl`. Tüm katsayılar 1 (**okuldan teyit edilmeli**; `docs/config/seconde-2026.json`'da düzenlenir).

## Motor sözleşmesi (`docs/engine.js`)

```js
weightedAverage([{note, outOf, coef}])          // → /20 ölçeğinde number | null (düz ağırlıklı ortalama)
pronoteAverage(grades)                          // → Pronote ders ortalaması (20'ye çevir · bonus · facultatif)
yearAverages(grades, {defaultPeriod})           // → {averages, periods} dönem ortalamalarının ortalaması
officialNote(subject, x) · inputStep(subject)   // resmî yuvarlama · girdi adımı
resolveOptions(config, data, chosen)            // → {options, forced} (zorunlu opsiyonlar dahil)
finalBac(config, notes)                         // → {final (aşağı kesik), raw, effective, lockedAvg, restAvg, totalCoef, …}
mention(final, config)                          // → {label, level, threshold, tone}
nextThreshold(final, config)                    // → {threshold, gapPoints, gapWeighted} | null
requiredNote(config, notes, subjectId, target)  // → number | 'unreachable' | 'safe'
requiredAverage(config, notes, target, {pinned}) // → serbest derslerde gereken ort. | 'unreachable' | 'safe' | null
distributeToTarget(config, notes, target, {pinned}) // → {reachable, notes, delta, raw, final, best, free}
leverage(config)                                // → [{subjectId, coef, deltaPerPoint}] katsayıya göre azalan
termAverage(config, gradesBySubject)            // → {subjects, general}
requiredTermNote(config, bySubject, target, {subjectId, count}) // → sonraki N notta gereken en küçük x
overallCheck(config, data)                      // → okul katsayısı sınaması: {status: none|match|mismatch, delta, tested, …}
specialiteScenarios(config, baseNotes, candidates)
buildBacNotes(config, data, 'kotu'|'gercekci'|'hedef')
```

Mention eşikleri config'ten: 10 Admis · 12 Assez bien · 14 Bien · 16 Très bien · 18 Très bien + félicitations; 8–10 rattrapage. Eşik ve mention **yuvarlanmamış** ortalamayla (`raw`) seçilir; gösterilen final iki ondalıkta **aşağı kesilir** (9,995 → 9,99, "10,00 + rattrapage" çelişkisi olmasın). Senaryo türetilirken ders notu yılın dönem ortalamalarının ortalamasıdır.

### Hedef aracı

- **A (bac):** kaydırıcı 10–20 (0,1 adım) + eşik kısayolları. "Sabit olmayan derslerde gereken ortalama" = (hedef × toplam katsayı − kilitli ve sabit derslerin resmî notları) ÷ sabit olmayan katsayı (yaklaşık; serbest derslerin yuvarlaması girmez). **"Notları hedefe göre ayarla"** sabit olmayan her notu aynı puan kadar kaydırır ve hedefi tutturan **en küçük** kaydırmayı ikili aramayla bulur; yeni not dersin ızgarasına oturur (sınav tam puan, kontrol continu bir üst onda bir, EPS tam puan), 20'ye dayanan dersin eksiği diğerlerine kalır. Sabit dersler (`pinned` varsayılanı, ör. zayıf ders) hiç oynamaz; "Bir üst eşik" ipucu da sabit dersi önermez. Ulaşılamıyorsa sabitler yerindeyken varılabilecek en yüksek ortalama yazılır.
- **B — okul katsayısı bandı:** sabit "Teyitsiz" uyarısı yerine veriye bağlı (O26): simülatörün dönem genel ortalaması (dosyadaki notlar, config katsayıları) Pronote'un kendi genel ortalamasıyla aynıysa yeşil **"Uyuşuyor"** + kaç dersin (zorunlu kaçının) sınandığı; farklıysa kırmızı **"Uyuşmuyor"** + fark (config/seconde-2026.json düzeltilmeli); veri yoksa "Teyitsiz". Tolerans 0,01 (Pronote iki ondalık). Not girilmemiş dersin katsayısı sınanamaz — kanıt not girildikçe güçlenir.
- **B (trimestre):** hedef 8–20; "her derse N not (kats. 1, /20) eklenirse" gereken en küçük not + ders ders "tek başına" tablosu. Pronote ders ortalaması kuralıyla hesaplanır; notu olmayan zorunlu ders eklenen notla ortalamaya girer, notu olmayan opsiyonel ders girmez.

## CI gizlilik denetimi

`scripts/privacy-check.mjs` yasaklı kişisel terimleri **repoya yazmadan** arar: terimler GitHub Actions secret'ı **`PRIVACY_TERMS`** (virgülle ayrılmış) ve yerelde gitignored `.privacy-terms.local` dosyasından okunur; diakritik/büyük-küçük harften bağımsız eşleşir. Secret tanımlı değilse adım uyarı verir ve geçer. `--messages[=<aralık>]` commit mesajlarını da tarar (depo açık; pre-push itilecek aralığı verir, CI tümünü). Her zaman çalışanlar: e-posta, okul Pronote sunucu adı ve telefon desenleri; not verisi taşıyan JSON'ın yalnız `docs/examples/*.example.json` içinde ve `"example": true` ile olması; `*.local.*` dosyalarının izlenmemesi. CI `--history` ile tüm geçmişi de tarar.

**Kurulum:** repo Settings → Secrets and variables → Actions → `PRIVACY_TERMS`.

## Açık sorular

- Seconde ders katsayıları (karneden okunacak).
- ~~LVC opsiyonunun bac katsayısı~~ — O25'te resmî metinden teyit edildi: her yıl 2, 100'e eklenir, takip edildiyse zorunlu.
- Okulun Pronote ayarları ("20'ye çevir" varsayılanı, yuvarlama, alt ders modu, ders katsayıları) — MyTaskBar her aktarımda simülatör hesabını Pronote'un kendi ortalamasıyla karşılaştırır, fark varsa günlüğe yazar (`notsim:` satırları).
- Okulun sunduğu spécialité listesi (`bac-2029.json` ulusal listeyi taşır).

## Kapsam dışı

Pronote entegrasyonu · otomatik not çekme · sunucu / backend · analitik veya izleme · üniversite başvuru takibi · IB simülasyonu · not trendi grafiği.
