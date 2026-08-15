/**
 * φ-rest — after fire, rest.
 * Called site bytes: φ-split + AES-256-GCM, open once, serve from RAM.
 * Not Chamber. Chamber is the product. This is the rest.
 */
import fs from "fs";
import path from "path";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const PHI = (1 + Math.sqrt(5)) / 2;

function mixIndex(i, n) {
  return Math.floor(i * PHI) % n;
}

export function phiSplit(key) {
  const a = randomBytes(key.length);
  const b = Buffer.alloc(key.length);
  for (let i = 0; i < key.length; i++) b[i] = key[i] ^ a[mixIndex(i, key.length)];
  return { a, b };
}

export function phiJoin(a, b) {
  const key = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) key[i] = b[i] ^ a[mixIndex(i, a.length)];
  return key;
}

export function cloak(plain) {
  const key = randomBytes(32);
  const shares = phiSplit(key);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  const tag = c.getAuthTag();
  return { iv, tag, ct, shares };
}

export function open(sealed) {
  const key = phiJoin(sealed.shares.a, sealed.shares.b);
  const d = createDecipheriv("aes-256-gcm", key, sealed.iv);
  d.setAuthTag(sealed.tag);
  return Buffer.concat([d.update(sealed.ct), d.final()]);
}

const hot = new Map();
let lastRoot = "";

export function createRest({ root, called = [] } = {}) {
  const map = new Map();
  const absRoot = root ? path.resolve(root) : process.cwd();
  function boot(extra = []) {
    let n = 0;
    let bytes = 0;
    for (const rel of [...called, ...extra]) {
      const file = path.isAbsolute(rel) ? rel : path.join(absRoot, rel);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
      const resolved = path.resolve(file);
      const opened = open(cloak(fs.readFileSync(resolved)));
      map.set(resolved, opened);
      n += 1;
      bytes += opened.length;
    }
    return { n, bytes };
  }
  function from(filePath) {
    if (!filePath) return null;
    return map.get(path.resolve(filePath)) || null;
  }
  return { boot, from, hot: map };
}

export function bootRest(root, called = []) {
  lastRoot = path.resolve(root);
  hot.clear();
  let n = 0;
  let bytes = 0;
  for (const rel of called) {
    const file = path.isAbsolute(rel) ? rel : path.join(lastRoot, rel);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    const resolved = path.resolve(file);
    const opened = open(cloak(fs.readFileSync(resolved)));
    hot.set(resolved, opened);
    n += 1;
    bytes += opened.length;
  }
  return { n, bytes };
}

export function fromRest(filePath) {
  if (!filePath) return null;
  return hot.get(path.resolve(filePath)) || null;
}

export function walkCalled(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...walkCalled(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}
