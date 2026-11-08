import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (existsSync('.env')) throw new Error('.env already exists; refusing to replace encryption key');
writeFileSync('.env', `HOST=127.0.0.1\nPORT=3480\nPUBLIC_ORIGIN=http://localhost:3480\nTOKEN_KEY=${randomBytes(32).toString('hex')}\nINVITE_CODE=${randomBytes(24).toString('base64url')}\n`, { mode: 0o600 });
console.log('Created .env. Find your private INVITE_CODE there, then run npm start.');
