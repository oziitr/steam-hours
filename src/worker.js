import SteamUser from 'steam-user';

export class Workers {
  constructor(store, makeClient = () => new SteamUser({ autoRelogin: true, renewRefreshTokens: true, dataDirectory: null })) {
    this.store = store; this.makeClient = makeClient; this.items = new Map();
    this.timer = setInterval(() => this.checkpoint(), 15000); this.timer.unref();
  }
  checkpoint() {
    for (const [id, item] of this.items) {
      if (item.since) {
        const now = Date.now();
        this.store.db.prepare('UPDATE accounts SET seconds=seconds+? WHERE id=?').run((now - item.since) / 1000, id);
        item.since = now;
      }
    }
  }
  status(id) {
    const item = this.items.get(id);
    return { state: item?.state || 'stopped', detail: item?.detail || '', pendingSeconds: item?.since ? (Date.now()-item.since)/1000 : 0 };
  }
  start(id) {
    this.stop(id);
    const account = this.store.account(id);
    if (!account) return;
    const client = this.makeClient();
    const item = { client, state: 'connecting', since: 0, detail: '' };
    this.items.set(id, item);
    const live = () => this.items.get(id) === item;
    const transition = (state, detail = '') => {
      if (!live()) return;
      this.checkpoint(); item.since = state === 'running' ? Date.now() : 0; item.state = state; item.detail = detail;
    };
    const play = () => {
      if (!live()) return;
      if (client.playingState?.blocked) return transition('paused', 'Başka cihazda oyun açık.');
      transition('running');
      client.gamesPlayed([this.store.account(id).appid]);
    };
    client.on('loggedOn', () => { if (live()) { client.setPersona(SteamUser.EPersonaState.Online); play(); } });
    client.on('playingState', blocked => {
      if (!live()) return;
      if (blocked) transition('paused', 'Başka cihazda oyun açık.');
      else if (item.state === 'paused') play();
    });
    client.on('refreshToken', token => {
      if (live()) this.store.db.prepare('UPDATE accounts SET token=? WHERE id=?').run(this.store.seal(token, id), id);
    });
    client.on('disconnected', () => { if (!item.failed) transition('connecting', 'Steam bağlantısı yeniden kuruluyor.'); });
    client.on('error', () => {
      if (!live()) return;
      item.failed = true;
      transition('error', 'Steam bağlantısı kurulamadı. Yeniden başlat veya QR ile hesabı yeniden bağla.');
      this.store.db.prepare('UPDATE accounts SET enabled=0 WHERE id=?').run(id);
      client.logOff();
    });
    client.on('steamGuard', () => {
      if (!live()) return;
      item.failed = true;
      transition('error', 'Steam doğrulaması gerekiyor. Hesabı QR ile yeniden bağla.');
      client.logOff();
      this.store.db.prepare('UPDATE accounts SET enabled=0 WHERE id=?').run(id);
    });
    try { client.logOn({ refreshToken: this.store.unseal(account.token, id) }); }
    catch { transition('error', 'Oturum açılamadı. Hesabı QR ile yeniden bağla.'); this.store.db.prepare('UPDATE accounts SET enabled=0 WHERE id=?').run(id); }
  }
  stop(id) {
    const item = this.items.get(id);
    if (!item) return;
    this.checkpoint(); this.items.delete(id);
    item.client.logOff();
  }
  restore() { for (const row of this.store.db.prepare('SELECT id FROM accounts WHERE enabled=1').all()) this.start(row.id); }
  close() { clearInterval(this.timer); for (const id of this.items.keys()) this.stop(id); }
}
