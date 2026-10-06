# data/ — gerçek notlar (yerel)

`a.json` (Öğrenci A) ve `b.json` (Öğrenci B) **yalnız MyTaskBar tarafından yazılır**
(`MyTaskBar/mtb/notsim.py`: her başarılı Pronote yenilemesinden sonra ve simülatör penceresi
açılırken; Pronote notları + sabit kayıt `MyTaskBar/kizlar/not-simulatoru-sabit.json`).
Elle düzenlenmez — bir sonraki aktarım üzerine yazar.

- Şema: `docs/schema/notes.schema.json` · ders kimlikleri: `README.md` → "Ders kimlikleri".
- Bu klasördeki `*.json` dosyaları `.gitignore` ile git dışıdır; asla commit edilmez.
- Doğrulama: `npm run validate` (= `node scripts/validate-data.mjs data/a.json data/b.json`).
