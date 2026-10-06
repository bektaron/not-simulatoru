/**
 * Web yayını için şifreleme — tarayıcıda ve Node'da (yayın betiği) aynı modül, yalnız WebCrypto.
 *
 * Kayıt GitHub Pages'te herkese açık durur; içerik ortak şifreden türetilen anahtarla AES-256-GCM şifrelidir.
 * Anahtar: PBKDF2-SHA256 (tuz + tur sayısı zarfta yazılı). Şifre hiçbir yerde saklanmaz: bilgisayarda
 * web-anahtar.local.json yalnız türetilmiş anahtarı, iPad'de tarayıcı yalnız türetilmiş anahtarı tutar.
 * Şifreli metin onaltılık (hex) yazılır — gizlilik denetiminin isim araması rastgele eşleşme bulamasın.
 *
 *   deriveKeyHex(password, saltHex, iter)  → anahtar (hex, 32 bayt)
 *   encryptText(text, {keyHex, saltHex, iter}) → zarf {v, alg, kdf, iter, salt, iv, ct}
 *   decryptEnvelope(env, keyHex)           → metin (yanlış anahtar / bozuk zarf → hata)
 */

export const KDF_ITER = 600000;
const ALG = 'AES-256-GCM';
const KDF = 'PBKDF2-SHA256';

const subtle = () => {
  const s = globalThis.crypto && globalThis.crypto.subtle;
  if (!s) throw new Error('Bu tarayıcıda şifre çözme yok (WebCrypto yalnız https ya da localhost üzerinde çalışır).');
  return s;
};

export function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex) {
  if (typeof hex !== 'string' || hex.length % 2 || /[^0-9a-f]/i.test(hex)) throw new Error('geçersiz hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function randomHex(n) {
  return toHex(globalThis.crypto.getRandomValues(new Uint8Array(n)));
}

export async function deriveKeyHex(password, saltHex, iter = KDF_ITER) {
  if (typeof password !== 'string' || !password) throw new Error('şifre boş');
  const base = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: iter }, base, 256);
  return toHex(new Uint8Array(bits));
}

const aesKey = (keyHex, use) => subtle().importKey('raw', fromHex(keyHex), 'AES-GCM', false, [use]);

export async function encryptText(text, { keyHex, saltHex, iter = KDF_ITER }) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, await aesKey(keyHex, 'encrypt'), new TextEncoder().encode(text));
  return { v: 1, alg: ALG, kdf: KDF, iter, salt: saltHex, iv: toHex(iv), ct: toHex(new Uint8Array(ct)) };
}

/** Zarf şekli doğru mu (içerik çözülmeden). */
export function isEnvelope(env) {
  return !!env && typeof env === 'object' && env.v === 1 && env.alg === ALG && env.kdf === KDF
    && Number.isInteger(env.iter) && env.iter > 0 && [env.salt, env.iv, env.ct].every((x) => typeof x === 'string' && /^[0-9a-f]+$/i.test(x));
}

export async function decryptEnvelope(env, keyHex) {
  if (!isEnvelope(env)) throw new Error('şifreli kayıt biçimi tanınmadı');
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: fromHex(env.iv) }, await aesKey(keyHex, 'decrypt'), fromHex(env.ct));
  return new TextDecoder().decode(pt);
}
