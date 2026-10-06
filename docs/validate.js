/**
 * Küçük JSON Schema (draft 2020-12 alt kümesi) doğrulayıcısı + config çapraz kontrolü.
 * Bağımlılıksız; tarayıcıda ve Node'da aynı dosya.
 *
 *   validate(schema, data)            → { valid, errors: [{path, keyword, message}] }
 *   assertSupported(schema)           → bilinmeyen anahtar kelimede fırlatır
 *   checkAgainstConfig(data, config)  → errors[] (subjectId ↔ config kimlikleri vb.)
 *   validateNotes(data, config, schema) → { valid, errors }
 *
 * Desteklenen anahtarlar: type, enum, const, required, properties,
 * additionalProperties, items, minItems, maxItems, minimum, maximum,
 * minLength, maxLength, pattern, format (date, date-time), $ref (#/$defs/… ve #), $defs.
 * Bilerek dışarıda: multipleOf, oneOf/anyOf/allOf, prefixItems, propertyNames.
 */

import { allSubjectIds, isNote } from './engine.js';

const SUPPORTED = new Set([
  '$schema', '$id', 'title', 'description', 'default', 'examples', 'deprecated',
  '$defs', '$ref', 'type', 'enum', 'const', 'required', 'properties',
  'additionalProperties', 'items', 'minItems', 'maxItems', 'minimum', 'maximum',
  'minLength', 'maxLength', 'pattern', 'format',
]);

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:\d{2})$/;

export function assertSupported(schema, path = '#') {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return;
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED.has(key)) throw new Error(`Desteklenmeyen şema anahtarı: ${key} (${path})`);
  }
  for (const [k, v] of Object.entries(schema.properties || {})) assertSupported(v, `${path}/properties/${k}`);
  for (const [k, v] of Object.entries(schema.$defs || {})) assertSupported(v, `${path}/$defs/${k}`);
  if (schema.items) assertSupported(schema.items, `${path}/items`);
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    assertSupported(schema.additionalProperties, `${path}/additionalProperties`);
  }
}

function typeMatches(v, t) {
  switch (t) {
    case 'null': return v === null;
    case 'array': return Array.isArray(v);
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'string': return typeof v === 'string';
    case 'boolean': return typeof v === 'boolean';
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'integer': return Number.isInteger(v);
    default: return false;
  }
}

function describeType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function resolveRef(ref, root) {
  if (ref === '#') return root;
  if (!ref.startsWith('#/')) throw new Error(`Yalnız yerel $ref desteklenir: ${ref}`);
  let cur = root;
  for (const part of ref.slice(2).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    cur = cur == null ? undefined : cur[key];
    if (cur === undefined) throw new Error(`$ref çözülemedi: ${ref}`);
  }
  return cur;
}

function checkFormat(fmt, s) {
  if (fmt === 'date') {
    const m = DATE_RE.exec(s);
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  if (fmt === 'date-time') return DATE_TIME_RE.test(s) && !Number.isNaN(Date.parse(s));
  return true; // bilinmeyen format: kontrol edilmez (draft davranışı)
}

function walk(schema, value, path, root, errors) {
  if (schema === true || schema == null) return;
  if (schema === false) { errors.push({ path, keyword: 'false', message: 'bu alana izin yok' }); return; }
  if (schema.$ref) walk(resolveRef(schema.$ref, root), value, path, root, errors);

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(value, t))) {
      errors.push({ path, keyword: 'type', message: `beklenen ${types.join('|')}, gelen ${describeType(value)}` });
      return;
    }
  }
  if (schema.enum && !schema.enum.some((e) => e === value)) {
    errors.push({ path, keyword: 'enum', message: `izin verilen değerler: ${schema.enum.join(', ')}` });
  }
  if (schema.const !== undefined && schema.const !== value) {
    errors.push({ path, keyword: 'const', message: `beklenen ${JSON.stringify(schema.const)}` });
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path, keyword: 'minimum', message: `${value} < ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path, keyword: 'maximum', message: `${value} > ${schema.maximum}` });
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push({ path, keyword: 'minLength', message: `en az ${schema.minLength} karakter` });
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push({ path, keyword: 'maxLength', message: `en çok ${schema.maxLength} karakter` });
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) errors.push({ path, keyword: 'pattern', message: `desene uymuyor: ${schema.pattern}` });
    if (schema.format !== undefined && !checkFormat(schema.format, value)) errors.push({ path, keyword: 'format', message: `geçersiz ${schema.format}` });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push({ path, keyword: 'minItems', message: `en az ${schema.minItems} öğe` });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push({ path, keyword: 'maxItems', message: `en çok ${schema.maxItems} öğe` });
    if (schema.items) value.forEach((v, i) => walk(schema.items, v, `${path}/${i}`, root, errors));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const r of schema.required || []) {
      if (!(r in value)) errors.push({ path: `${path}/${r}`, keyword: 'required', message: 'zorunlu alan eksik' });
    }
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (k in props) walk(props[k], v, `${path}/${k}`, root, errors);
      else if (schema.additionalProperties === false) errors.push({ path: `${path}/${k}`, keyword: 'additionalProperties', message: 'tanımsız alan' });
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') walk(schema.additionalProperties, v, `${path}/${k}`, root, errors);
    }
  }
}

export function validate(schema, data) {
  const errors = [];
  walk(schema, data, '', schema, errors);
  return { valid: errors.length === 0, errors };
}

/**
 * Şemanın ifade edemediği kurallar: kimlikler config'te var mı, locked yalnız
 * kilitli dersi olan config'te, locked.coef config ile uyumlu, note ≤ outOf,
 * dönem indeksi config'in dönem sayısını aşmıyor.
 */
export function checkAgainstConfig(data, config) {
  const errors = [];
  const err = (path, message) => errors.push({ path, keyword: 'config', message });
  if (!data || typeof data !== 'object' || !config) return errors;
  const ids = allSubjectIds(config);
  const lockedIds = new Set((config.subjects || []).filter((s) => s.locked).map((s) => s.id));
  for (const o of config.options || []) for (const s of o.subjects || []) if (s.locked) lockedIds.add(s.id);

  (Array.isArray(data.grades) ? data.grades : []).forEach((g, i) => {
    if (!g) return;
    if (!ids.has(g.subjectId)) err(`/grades/${i}/subjectId`, `config'te olmayan ders: ${g.subjectId}`);
    if (isNote(g.note) && isNote(g.outOf) && g.note > g.outOf) err(`/grades/${i}/note`, `not (${g.note}) barajı (${g.outOf}) aşıyor`);
    if (isNote(g.note) && !isNote(g.outOf) && g.note > 20) err(`/grades/${i}/note`, `not (${g.note}) 20'yi aşıyor (outOf belirtilmemiş)`);
  });
  (Array.isArray(data.upcoming) ? data.upcoming : []).forEach((u, i) => {
    if (u && !ids.has(u.subjectId)) err(`/upcoming/${i}/subjectId`, `config'te olmayan ders: ${u.subjectId}`);
  });
  if (Array.isArray(data.locked) && data.locked.length) {
    if (lockedIds.size === 0) err('/locked', 'bu config\'te kilitli ders yok; locked boş olmalı');
    const coefOf = {};
    for (const s of config.subjects || []) coefOf[s.id] = s.coef;
    for (const o of config.options || []) for (const s of o.subjects || []) coefOf[s.id] = s.coef;
    data.locked.forEach((l, i) => {
      if (!l) return;
      if (!ids.has(l.id)) err(`/locked/${i}/id`, `config'te olmayan ders: ${l.id}`);
      else if (!lockedIds.has(l.id)) err(`/locked/${i}/id`, `kilitli olmayan ders: ${l.id}`);
      if (isNote(l.coef) && ids.has(l.id) && l.coef !== coefOf[l.id]) err(`/locked/${i}/coef`, `katsayı config ile uyuşmuyor (${l.coef} ≠ ${coefOf[l.id]})`);
    });
  }
  for (const [name, map] of Object.entries(data.scenarios || {})) {
    for (const id of Object.keys(map || {})) {
      if (!ids.has(id)) err(`/scenarios/${name}/${id}`, `config'te olmayan ders: ${id}`);
      else if (lockedIds.has(id)) err(`/scenarios/${name}/${id}`, `kilitli ders senaryoda olamaz: ${id}`);
    }
  }
  for (const id of Object.keys(data.subjectLabels || {})) {
    if (!ids.has(id)) err(`/subjectLabels/${id}`, `config'te olmayan ders: ${id}`);
  }
  for (const id of Object.keys(data.premiere || {})) {
    if (!ids.has(id)) err(`/premiere/${id}`, `config'te olmayan ders: ${id}`);
    else if (lockedIds.has(id)) err(`/premiere/${id}`, `kilitli ders: 1ère notu zaten locked'da: ${id}`);
  }
  (Array.isArray(data.pinned) ? data.pinned : []).forEach((id, i) => {
    if (!ids.has(id)) err(`/pinned/${i}`, `config'te olmayan ders: ${id}`);
    else if (lockedIds.has(id)) err(`/pinned/${i}`, `kilitli ders zaten sabittir: ${id}`);
  });
  const periodCount = Array.isArray(config.periods) ? config.periods.length : 3;
  if (data.period) {
    if (config.periodSystem && data.period.type !== config.periodSystem) err('/period/type', `config dönem sistemi: ${config.periodSystem}`);
    if (isNote(data.period.index) && data.period.index > periodCount) err('/period/index', `config'te ${periodCount} dönem var`);
  }
  (Array.isArray(data.grades) ? data.grades : []).forEach((g, i) => {
    if (g && isNote(g.period) && g.period > periodCount) err(`/grades/${i}/period`, `config'te ${periodCount} dönem var`);
  });
  if (data.pronoteOverall && isNote(data.pronoteOverall.period) && data.pronoteOverall.period > periodCount) {
    err('/pronoteOverall/period', `config'te ${periodCount} dönem var`);
  }
  return errors;
}

export function validateNotes(data, config, schema) {
  const base = schema ? validate(schema, data) : { valid: true, errors: [] };
  const errors = base.errors.concat(base.valid ? checkAgainstConfig(data, config) : []);
  return { valid: errors.length === 0, errors };
}

export function formatErrors(errors, max = 8) {
  const lines = errors.slice(0, max).map((e) => `${e.path || '/'}: ${e.message}`);
  if (errors.length > max) lines.push(`… ve ${errors.length - max} hata daha`);
  return lines;
}
