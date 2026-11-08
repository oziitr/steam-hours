import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Store } from '../src/store.js';
import { Workers } from '../src/worker.js';
import { createApp } from '../src/app.js';

const key = 'a'.repeat(64), invite = 'test-invite-code-long-enough', origin = 'http://localhost:3480';
class Client extends EventEmitter {
  playingState = { blocked: false }; plays=[];
  logOn(details) { this.details=details; }
  logOff() { this.emit('disconnected'); }
  setPersona() {}
  gamesPlayed(apps) { this.plays.push(apps); this.emit('playingState',false); }
}
test('encryption authenticates ciphertext and binds it to the account', () => {
  const store = new Store(':memory:',key);
  const token=store.seal('private-token','1');
  assert.equal(store.unseal(token,'1'),'private-token');
  assert.throws(()=>store.unseal(token,'2'));
  const raw=Buffer.from(token,'base64'); raw[30]^=1;
  assert.throws(()=>store.unseal(raw.toString('base64'),'1'));
  store.db.close();
});
test('worker pauses, resumes, reconnects, persists time and ignores old clients', () => {
  const store = new Store(':memory:',key), clients=[];
  store.db.prepare('INSERT INTO users VALUES(?,?,?)').run('owner','owner','unused');
  store.saveAccount('owner','123','steam','private-token');
  const workers=new Workers(store,()=>{const c=new Client();clients.push(c);return c;});
  workers.start('123'); assert.equal(workers.status('123').state,'connecting');
  clients[0].emit('loggedOn'); assert.deepEqual(clients[0].plays,[[730]]);
  workers.items.get('123').since=Date.now()-10000;
  clients[0].emit('playingState',true);
  assert.equal(workers.status('123').state,'paused'); assert.ok(store.account('123').seconds>=10);
  assert.equal(workers.status('123').pendingSeconds,0);
  clients[0].emit('playingState',false); assert.equal(workers.status('123').state,'running');
  clients[0].emit('disconnected'); assert.equal(workers.status('123').state,'connecting');
  clients[0].emit('loggedOn'); assert.equal(workers.status('123').state,'running');
  workers.start('123'); clients[0].emit('playingState',true);
  assert.equal(workers.status('123').state,'connecting');
  workers.stop('123'); assert.equal(workers.status('123').state,'stopped');
  workers.close(); store.db.close();
});
test('HTTP: auth, CSRF, ownership, QR lifecycle and validated start/stop', async t => {
  const store=new Store(':memory:',key), workers=new Workers(store,()=>new Client()), logins=[];
  class Login extends EventEmitter {
    steamID={getSteamID64:()=> '76561198000000001'}; accountName='test-steam'; refreshToken='secret-token';
    async startWithQR() { return {qrChallengeUrl:'https://s.team/q/1/2'}; }
    cancelLoginAttempt() {this.cancelled=true;}
  }
  const app=createApp({store,workers,origin,invite,makeLogin:()=>{const l=new Login();logins.push(l);return l;}});
  const server=app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{app.close();workers.close();await new Promise(resolve=>server.close(resolve));store.db.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=async(path,method='GET',body,cookie='',customOrigin=origin)=>{
    const res=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json','X-Requested-With':'SteamHours',Origin:customOrigin,Cookie:cookie},body:body?JSON.stringify(body):undefined});
    return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
  };
  assert.equal((await call('/accounts')).status,401);
  assert.equal((await call('/register','POST',{name:'alice',password:'secure-password',invite},'','https://evil.example')).status,403);
  assert.equal((await call('/register','POST',{name:'alice',password:'secure-password',invite:'wrong'})).status,403);
  const alice=await call('/register','POST',{name:'alice',password:'secure-password',invite});
  assert.equal(alice.status,200); assert.ok(alice.cookie);
  assert.equal((await call('/me','GET',null,alice.cookie)).body.name,'alice');
  const bob=await call('/register','POST',{name:'bob',password:'secure-password',invite});
  assert.equal(bob.status,200);
  assert.equal((await call('/steam/qr','POST',{},alice.cookie)).status,200);
  logins[0].emit('authenticated');
  assert.equal((await call('/steam/qr','GET',null,alice.cookie)).body.state,'done');
  const list=await call('/accounts','GET',null,alice.cookie);
  assert.equal(list.body.length,1); assert.equal(list.body[0].token,undefined);
  const id=list.body[0].id;
  assert.equal((await call('/accounts','GET',null,bob.cookie)).body.length,0);
  assert.equal((await call(`/accounts/${id}/start`,'POST',{appid:730},bob.cookie)).status,404);
  assert.equal((await call(`/accounts/${id}`,'DELETE',null,bob.cookie)).status,404);
  assert.equal((await call(`/accounts/${id}/start`,'POST',{appid:-1},alice.cookie)).status,400);
  assert.equal((await call(`/accounts/${id}/start`,'POST',{appid:730},alice.cookie)).status,200);
  assert.equal(store.account(id).enabled,1);
  assert.equal((await call(`/accounts/${id}/stop`,'POST',{},alice.cookie)).status,200);
  assert.equal(store.account(id).enabled,0);
  await call('/steam/qr','POST',{},bob.cookie);logins[1].emit('authenticated');
  assert.equal((await call('/steam/qr','GET',null,bob.cookie)).body.state,'error');
  assert.equal(store.account(id).owner,(await call('/me','GET',null,alice.cookie)).body.id);
  await call('/steam/qr','POST',{},alice.cookie);await call('/steam/qr','DELETE',null,alice.cookie);
  logins[2].accountName='cancelled-name';logins[2].emit('authenticated');
  assert.equal(store.account(id).name,'test-steam');
  await call(`/accounts/${id}`,'DELETE',null,alice.cookie);assert.equal(store.account(id),undefined);
  await call('/logout','POST',{},alice.cookie);assert.equal((await call('/me','GET',null,alice.cookie)).status,401);
  assert.equal((await call('/login','POST',{name:'alice',password:'wrong-password'})).status,401);
  assert.equal((await call('/login','POST',{name:'alice',password:'secure-password'})).status,200);
});
