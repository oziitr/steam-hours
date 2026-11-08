import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
export async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${(await derive(password, salt, 64)).toString('hex')}`;
}
export async function passwordMatches(password, hash) {
  const result = await passwordHash(password, hash.split(':')[0]);
  return timingSafeEqual(Buffer.from(result), Buffer.from(hash));
}
export class Store {
  constructor(path, key) {
    if (!/^[a-f0-9]{64}$/i.test(key || '')) throw new Error('TOKEN_KEY must be 64 hex characters');
    this.key = Buffer.from(key, 'hex');
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
        token TEXT NOT NULL, appid INTEGER NOT NULL DEFAULT 730, enabled INTEGER NOT NULL DEFAULT 0, seconds REAL NOT NULL DEFAULT 0);`);
  }
  seal(value, id) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(id));
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  }
  unseal(value, id) {
    const data = Buffer.from(value, 'base64'), cipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
    cipher.setAAD(Buffer.from(id)); cipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
  }
  accounts(owner) { return this.db.prepare('SELECT * FROM accounts WHERE owner=?').all(owner); }
  account(id) { return this.db.prepare('SELECT * FROM accounts WHERE id=?').get(id); }
  saveAccount(owner, id, name, token) {
    const old = this.account(id);
    if (old && old.owner !== owner) throw new Error('Bu Steam hesabı başka bir panel hesabına bağlı.');
    this.db.prepare(`INSERT INTO accounts(id,owner,name,token) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,token=excluded.token`).run(id, owner, name, this.seal(token, id));
  }
}
