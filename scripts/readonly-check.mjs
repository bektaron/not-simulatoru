#!/usr/bin/env node
/**
 * Yerel/salt-okunur denetimi: site kodunda (docs/**, .js/.html) yazma çağrısı
 * (PUT/POST/PATCH/DELETE), yan kanal (XHR, WebSocket, beacon) veya herhangi bir
 * dış adres (http(s)://…) bulunamaz. Simülatör yalnız yerel kaydı okur.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(process.cwd(), 'docs');
const WRITE_METHOD = /['"`](PUT|POST|PATCH|DELETE)['"`]/g;
const WRITE_METHOD_KEY = /method\s*:\s*['"`](?!GET['"`])/gi;
const XHR = /XMLHttpRequest|sendBeacon|WebSocket|EventSource/g;
const EXTERNAL = /(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/gi; // site hiçbir dış adrese bağlanmaz

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|mjs|html)$/.test(name)) out.push(p);
  }
  return out;
}

let failures = 0;
for (const file of walk(ROOT)) {
  const rel = path.relative(process.cwd(), file);
  const text = readFileSync(file, 'utf8');
  text.split('\n').forEach((line, i) => {
    for (const re of [WRITE_METHOD, WRITE_METHOD_KEY, XHR, EXTERNAL]) {
      re.lastIndex = 0;
      if (re.test(line)) { failures++; console.log(`::error file=${rel},line=${i + 1}::yazma / dış bağlantı şüphesi: ${line.trim().slice(0, 100)}`); }
    }
  });
}
console.log(`Salt-okunur denetimi: ${failures} bulgu.`);
process.exit(failures ? 1 : 0);
