import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { LoginSession, EAuthTokenPlatformType } from 'steam-session';
import QRCode from 'qrcode';
import { fileURLToPath } from 'node:url';
import { passwordHash, passwordMatches } from './store.js';

export function createApp({ store, workers, origin, invite, makeLogin = () => new LoginSession(EAuthTokenPlatformType.SteamClient) }) {
  if (!invite || invite.length < 20) throw new Error('INVITE_CODE must contain at least 20 characters');
  const app = express(), sessions = new Map(), pending = new Map();
  const secure = new URL(origin).protocol === 'https:';
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
    next();
  });
  app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /\n'));
  app.use(helmet({ contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'data:'], 'upgrade-insecure-requests': secure ? [] : null } }, strictTransportSecurity: secure ? undefined : false }));
  app.use(express.json({ limit: '8kb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method) && (req.get('Origin') !== origin || req.get('X-Requested-With') !== 'SteamHours')) return res.status(403).json({ error: 'İstek kaynağı doğrulanamadı.' });
    const sid = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('steam_hours_sid='))?.slice(16);
    const session = sessions.get(sid);
    if (session && session.expires > Date.now()) { req.user = session.user; req.sid = sid; }
    next();
  });
  const authLimit = rateLimit({ windowMs: 15*60*1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Çok fazla deneme. 15 dakika sonra tekrar dene.' } });
  const cookie = (res, value, maxAge) => res.cookie('steam_hours_sid', value, { httpOnly: true, secure, sameSite: 'strict', maxAge, path: '/' });
  const signIn = (req, res, user) => {
    if (req.sid) sessions.delete(req.sid);
    const sid = randomBytes(32).toString('hex');
    sessions.set(sid, { user: { id: user.id, name: user.name }, expires: Date.now()+86400000 });
    cookie(res, sid, 86400000); res.json({ ok: true });
  };
  const validCredentials = body => typeof body.name === 'string' && /^[a-zA-Z0-9_-]{3,32}$/.test(body.name) && typeof body.password === 'string' && body.password.length >= 12 && body.password.length <= 128;
  app.post('/api/register', authLimit, async (req, res) => {
    if (!validCredentials(req.body)) return res.status(400).json({ error: 'Kullanıcı adı 3–32 harf/rakam, şifre 12–128 karakter olmalı.' });
    const provided = Buffer.from(String(req.body.invite || '')), expected = Buffer.from(invite);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return res.status(403).json({ error: 'Davet kodu geçersiz.' });
    const name = req.body.name.toLowerCase(), id = randomUUID(), hash = await passwordHash(req.body.password);
    try { store.db.prepare('INSERT INTO users VALUES(?,?,?)').run(id, name, hash); }
    catch { return res.status(409).json({ error: 'Bu kullanıcı adı kullanılıyor.' }); }
    signIn(req, res, { id, name });
  });
  app.post('/api/login', authLimit, async (req, res) => {
    if (!validCredentials(req.body)) return res.status(401).json({ error: 'Giriş bilgileri geçersiz.' });
    const user = store.db.prepare('SELECT * FROM users WHERE name=?').get(req.body.name.toLowerCase());
    const hash = user?.hash || await passwordHash('invalid-password-placeholder');
    if (!(await passwordMatches(req.body.password, hash)) || !user) return res.status(401).json({ error: 'Giriş bilgileri geçersiz.' });
    signIn(req, res, user);
  });
  app.use('/api', (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Panele giriş yap.' }));
  app.get('/api/me', (req, res) => res.json(req.user));
  const cancel = owner => { const old = pending.get(owner); pending.delete(owner); old?.session.cancelLoginAttempt(); };
  app.post('/api/logout', (req, res) => { cancel(req.user.id); sessions.delete(req.sid); cookie(res, '', 0); res.json({ ok: true }); });
  app.get('/api/accounts', (req, res) => res.json(store.accounts(req.user.id).map(a => {
    const status = workers.status(a.id);
    return { id: a.id, name: a.name, appid: a.appid, enabled: !!a.enabled, seconds: a.seconds+status.pendingSeconds, state: status.state, detail: status.detail };
  })));
  app.post('/api/steam/qr', rateLimit({ windowMs: 60000, limit: 5, message: { error: 'Bir dakika sonra yeniden dene.' } }), async (req, res) => {
    const owner = req.user.id;
    if (store.accounts(owner).length >= 5) return res.status(400).json({ error: 'En fazla 5 hesap bağlanabilir. Yeniden bağlamak için önce hesabı kaldır.' });
    cancel(owner);
    const session = makeLogin(), attempt = { session, state: 'waiting', expires: Date.now()+120000 };
    pending.set(owner, attempt); session.loginTimeout = 120000;
    session.on('authenticated', () => {
      if (pending.get(owner) !== attempt || Date.now() >= attempt.expires) return;
      try {
        const id = session.steamID.getSteamID64();
        store.saveAccount(owner, id, session.accountName || id, session.refreshToken);
        attempt.state = 'done';
        if (store.account(id).enabled) workers.start(id);
      } catch { attempt.state = 'error'; attempt.error = 'Hesap kaydedilemedi veya başka kullanıcıya bağlı.'; }
    });
    session.on('timeout', () => { attempt.state = 'expired'; });
    session.on('error', () => { attempt.state = 'error'; attempt.error = 'Steam girişini tamamlayamadı. Yeniden dene.'; });
    try {
      const result = await session.startWithQR();
      const qr = await QRCode.toDataURL(result.qrChallengeUrl, { width: 280, margin: 2 });
      if (pending.get(owner) !== attempt) return res.status(409).json({ error: 'Giriş iptal edildi.' });
      res.json({ qr, expires: attempt.expires });
    } catch { cancel(owner); res.status(502).json({ error: 'Steam bağlantısı kurulamadı. Biraz sonra yeniden dene.' }); }
  });
  app.get('/api/steam/qr', (req, res) => {
    const p = pending.get(req.user.id);
    res.json({ state: p?.state || 'expired', error: p?.error });
  });
  app.delete('/api/steam/qr', (req, res) => { cancel(req.user.id); res.json({ ok: true }); });
  app.param('id', (req, res, next, id) => {
    const a = store.account(id);
    if (!a || a.owner !== req.user.id) return res.status(404).json({ error: 'Hesap bulunamadı.' });
    req.account = a; next();
  });
  app.post('/api/accounts/:id/start', (req, res) => {
    const appid = req.body.appid;
    if (!Number.isSafeInteger(appid) || appid < 1 || appid > 2147483647) return res.status(400).json({ error: 'Geçerli bir Steam App ID gir.' });
    store.db.prepare('UPDATE accounts SET enabled=1,appid=? WHERE id=?').run(appid, req.account.id);
    workers.start(req.account.id); res.json({ ok: true });
  });
  app.post('/api/accounts/:id/stop', (req, res) => {
    store.db.prepare('UPDATE accounts SET enabled=0 WHERE id=?').run(req.account.id);
    workers.stop(req.account.id); res.json({ ok: true });
  });
  app.delete('/api/accounts/:id', (req, res) => {
    workers.stop(req.account.id); store.db.prepare('DELETE FROM accounts WHERE id=?').run(req.account.id); res.json({ ok: true });
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'İşlem bulunamadı.' }));
  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
  app.use((err, req, res, next) => res.status(err.status === 400 ? 400 : 500).json({ error: 'İşlem tamamlanamadı.' }));
  const timer = setInterval(() => {
    for (const [sid, s] of sessions) if (s.expires <= Date.now()) sessions.delete(sid);
    for (const [owner, p] of pending) if (p.expires <= Date.now()) cancel(owner);
  }, 30000); timer.unref();
  app.close = () => { clearInterval(timer); for (const owner of pending.keys()) cancel(owner); sessions.clear(); };
  return app;
}
