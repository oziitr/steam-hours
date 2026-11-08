import { resolve } from 'node:path';
import { Store } from './store.js';
import { Workers } from './worker.js';
import { createApp } from './app.js';
const port = Number(process.env.PORT || 3480);
const origin = process.env.PUBLIC_ORIGIN || `http://localhost:${port}`;
const url = new URL(origin);
if (url.origin !== origin || (!['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol !== 'https:')) throw new Error('PUBLIC_ORIGIN must be an exact HTTPS origin (HTTP only for localhost)');
const store = new Store(resolve(process.env.DATA_DIR || 'data', 'hours.db'), process.env.TOKEN_KEY);
const workers = new Workers(store);
const app = createApp({ store, workers, origin, invite: process.env.INVITE_CODE });
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Steam Hours listening on ${port}`));
workers.restore();
let closing = false;
function shutdown() {
  if (closing) return; closing = true;
  app.close(); workers.close(); server.close(() => { store.db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
