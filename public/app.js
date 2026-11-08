const $ = s => document.querySelector(s);
let mode = 'login', user = null, timer, qrTimer, toastTimer, qrGeneration = 0;
const labels = { stopped: 'Durduruldu', connecting: 'Bağlanıyor', running: 'Etkin', paused: 'Duraklatıldı', error: 'Bağlantı hatası' };
function notice(message) { $('#notice').textContent = message; $('#notice').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#notice').hidden = true, 7000); }
async function api(path, method = 'GET', body) {
  const res = await fetch(`./api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'SteamHours' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) { if (res.status === 401 && user) showAuth(); throw new Error(data.error || 'İşlem tamamlanamadı.'); }
  return data;
}
function showAuth() { user = null; clearInterval(timer); closeQr(); $('#auth').hidden = false; $('#dashboard').hidden = true; $('#userbar').hidden = true; $('#private-label').hidden = false; }
function setMode(next) { mode = next; $('#login-tab').classList.toggle('selected', mode === 'login'); $('#register-tab').classList.toggle('selected', mode === 'register'); $('#invite-field').hidden = mode === 'login'; $('#invite-field input').required = mode === 'register'; $('#auth-submit').textContent = mode === 'login' ? 'Giriş yap' : 'Hesap oluştur'; $('#auth-title').textContent = mode === 'login' ? 'Paneline hoş geldin.' : 'Kendi alanını oluştur.'; $('[name=password]').autocomplete = mode === 'login' ? 'current-password' : 'new-password'; }
$('#login-tab').onclick = () => setMode('login'); $('#register-tab').onclick = () => setMode('register');
$('#auth-form').onsubmit = async event => { event.preventDefault(); $('#auth-submit').disabled = true; try { await api(`/${mode}`, 'POST', Object.fromEntries(new FormData(event.target))); event.target.reset(); await showDashboard(); } catch(e) { notice(e.message); } finally { $('#auth-submit').disabled = false; } };
$('#logout').onclick = async () => { try { await api('/logout', 'POST'); showAuth(); } catch(e) { notice(e.message); } };
const hours = seconds => `${(seconds/3600).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} sa`;
function element(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if(className) el.className = className; return el; }
function card(account) {
  const row = element('article', undefined, 'account'); row.dataset.id = account.id;
  const identity = element('div'); identity.append(element('h3', account.name), element('small', account.id), element('br'), element('span', labels[account.state], `state ${account.state}`));
  const label = element('label', 'Oyun App ID'); const input = element('input'); input.type='number'; input.min='1'; input.max='2147483647'; input.value=account.appid; input.setAttribute('aria-label', `${account.name} için oyun App ID`); label.append(input);
  const time = element('div', hours(account.seconds), 'time');
  const actions = element('div', undefined, 'actions');
  const toggle = element('button', account.enabled ? 'Durdur' : 'Başlat', account.enabled ? '' : 'primary');
  toggle.onclick = async () => { toggle.disabled = true; try { await api(`/accounts/${account.id}/${account.enabled ? 'stop' : 'start'}`, 'POST', { appid: Number(input.value) }); await refresh(true); } catch(e) { notice(e.message); } finally { toggle.disabled = false; } };
  const remove = element('button','Kaldır','quiet'); remove.onclick = async () => { if (!confirm(`${account.name} hesabının bağlantısı kaldırılsın mı?`)) return; remove.disabled = true; try { await api(`/accounts/${account.id}`, 'DELETE'); await refresh(true); } catch(e) { notice(e.message); } finally { remove.disabled=false; } };
  actions.append(toggle,remove); row.append(identity,label,time,actions); if(account.detail) row.append(element('p',account.detail,'detail')); return row;
}
async function refresh(force = false) {
  try {
    const accounts = await api('/accounts');
    $('#count').textContent = accounts.length; $('#active').textContent = accounts.filter(a=>a.state==='running').length; $('#hours').textContent = hours(accounts.reduce((n,a)=>n+a.seconds,0));
    $('#empty').hidden = accounts.length > 0;
    if (force || !$('#accounts').contains(document.activeElement)) {
      const edits = new Map([...$('#accounts .account')].map(el=>[el.dataset.id,el.querySelector('input').value]));
      $('#accounts').replaceChildren(...accounts.map(a=>{ const el=card(a); if(edits.has(a.id) && !force) el.querySelector('input').value=edits.get(a.id); return el; }));
    }
    $('#sync-state').textContent = 'Az önce güncellendi';
  } catch(e) { $('#sync-state').textContent = 'Bağlantı kesildi'; if(force) notice(e.message); }
}
async function showDashboard() { user = await api('/me'); $('#username').textContent=user.name; $('#auth').hidden=true; $('#dashboard').hidden=false; $('#userbar').hidden=false; $('#private-label').hidden=true; await refresh(true); clearInterval(timer); timer=setInterval(refresh,5000); }
function closeQr() { qrGeneration++; clearInterval(qrTimer); if($('#qr-dialog').open) $('#qr-dialog').close(); }
async function cancelQr() { closeQr(); try { await api('/steam/qr','DELETE'); } catch {} }
async function openQr() {
  const generation = ++qrGeneration; clearInterval(qrTimer);
  if(!$('#qr-dialog').open) $('#qr-dialog').showModal();
  $('#qr-content').replaceChildren(element('p','QR kodu hazırlanıyor…')); $('#qr-status').textContent=''; $('#retry-qr').hidden=true;
  try {
    const data = await api('/steam/qr','POST'); if(generation !== qrGeneration) return;
    const img = element('img'); img.src=data.qr; img.alt='Steam uygulamasında taranacak giriş QR kodu'; $('#qr-content').replaceChildren(img);
    $('#qr-status').textContent='Steam uygulamasından onay bekleniyor…';
    qrTimer = setInterval(async()=>{
      try {
        const result=await api('/steam/qr'); if(generation !== qrGeneration) return;
        if(result.state==='done') { closeQr(); await refresh(true); notice('Steam hesabın bağlandı. Hazırsan oturumu başlat.'); }
        else if(['expired','error'].includes(result.state) || Date.now()>data.expires) { clearInterval(qrTimer); $('#qr-content').replaceChildren(element('p','Bu QR kodu artık kullanılamaz.')); $('#qr-status').textContent=result.error || 'Kodun süresi doldu.'; $('#retry-qr').hidden=false; }
      } catch(e) { clearInterval(qrTimer); $('#qr-status').textContent=e.message; $('#retry-qr').hidden=false; }
    },2000);
  } catch(e) { if(generation !== qrGeneration) return; $('#qr-content').replaceChildren(element('p',e.message)); $('#retry-qr').hidden=false; }
}
$('#add-account').onclick=openQr; $('#empty-add').onclick=openQr; $('#retry-qr').onclick=openQr; $('#close-qr').onclick=cancelQr;
$('#qr-dialog').addEventListener('cancel', event=>{event.preventDefault(); cancelQr();});
showDashboard().catch(()=>showAuth());
