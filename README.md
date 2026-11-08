# Steam Hours

Kendi VDS'inde çalışan, Türkçe arayüzlü Steam oturum yöneticisi. Oyun dosyalarını veya Steam masaüstü uygulamasını indirmeden Steam istemci protokolüyle oyun etkinliği bildirir. CS2'nin App ID'si `730` başlangıç değeridir.

## Özellikler

- Davet koduyla panel kaydı ve kullanıcı başına ayrılmış hesaplar (en fazla 5).
- Steam mobil uygulaması üzerinden QR girişi; panel Steam şifresi istemez.
- Başlat, durdur, oyun App ID değiştir ve hesap bağlantısını kaldır.
- Başka oturumda oyun algılandığında duraklama, engel kalkınca devam.
- Bağlantı koptuğunda kütüphane üzerinden yeniden bağlantı; servis yeniden başlayınca etkin hesapları geri yükleme.
- SQLite kalıcı veri, scrypt panel şifreleri, AES-256-GCM ile hesap kimliğine bağlı şifreli Steam tokenları.
- HTTP-only oturum çerezi, HTTPS zorunluluğu (localhost hariç), kaynak kontrolü ve giriş hız sınırı.

Panel sayacı yalnızca uygulamanın etkin bağlantı süresidir; Steam'in doğruladığı oyun saati değildir. Steam'in süreyi işlemesi ayrıca kontrol edilmelidir. Saat yazılacağı veya hesap yaptırımı olmayacağı garanti edilmez. Kendi hesaplarında ve erişebildiğin oyunlarda kullan. Bu proje Valve tarafından onaylanmış değildir.

## Yerel çalıştırma

Node.js 24+ gerekir.

```sh
npm ci
npm run setup
npm start
```

`http://localhost:3480` adresini aç. `.env` dosyasındaki `INVITE_CODE` ile panel hesabı oluştur. Steam hesabı bağla düğmesinden QR kodunu Steam Guard ile tara, sunucu oturumunu onayla, ardından Başlat'a bas.

## Linux VDS

1. Projeyi `/opt/steam-hours` altına kopyala ve `npm ci --omit=dev` çalıştır.
2. `npm run setup` çalıştır. `.env` içinde `PUBLIC_ORIGIN=https://alan-adin.example` ayarla (sonunda eğik çizgi veya alt yol olmamalı). `TOKEN_KEY` değerini değiştirme; kaybedersen kayıtlı Steam oturumları çözülemez.
3. Ayrı `steam-hours` sistem kullanıcısı oluştur; `data/` klasörünün sahibi bu kullanıcı olsun. Kod salt okunur kalabilir; `.env` yalnızca servis kullanıcısı ve root tarafından okunabilmeli.
4. `deploy/steam-hours.service` içindeki Node yolunu sunucuna göre ayarla, `/etc/systemd/system/` altına koy. `systemctl daemon-reload` ve `systemctl enable --now steam-hours` çalıştır.
5. `deploy/nginx.conf` içindeki yolları mevcut HTTPS sanal sunucuna ekle. `nginx -t` başarılıysa Nginx'i yeniden yükle. Plesk'te üretilen nginx.conf'u düzenleme; ek Nginx yönergelerini kullan.
6. Panel `https://alan-adin.example/steam-hours/` adresindedir. Node yalnızca loopback üzerinde dinler; 3480 portunu internete açma.

Ters vekil X-Forwarded-For güveni varsayılan olarak kapalıdır. Bu yüzden giriş/QR hız sınırı tek vekilin arkasındaki kullanıcılar için ortaktır. Küçük, davetli kişisel kurulum için tasarlanmıştır; büyük ve herkese açık bir SaaS hizmeti değildir. Tek Node süreci kullan: SQLite verisi kalıcı, web oturumları bellektedir; servis yeniden başlayınca panele tekrar giriş gerekir.

### Parola korumalı ayrı subdomain

Plesk üzerinde ayrı subdomain kullanıyorsan ek Nginx yönergeleri için `deploy/nginx-subdomain.conf` şablonunu kullan. `/etc/nginx/steam-hours.htpasswd` dosyasını `htpasswd -cB` ile oluştur; dosyayı Nginx'in okuyabildiği, diğer kullanıcıların yazamadığı izinlerle koru. `PUBLIC_ORIGIN` değerini yeni HTTPS origin ile eşleştir. Önceki alt yol yönlendirmesini kapat; aksi hâlde ek parola koruması eski adres üzerinden aşılabilir. DNS kaydı ve geçerli HTTPS yapılandırması ayrıca gerekir.

Uygulama `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` ve taramaya kapalı `robots.txt` sunar. Bunlar arama motorlarına yönelik yönergelerdir, erişim kontrolü değildir. Genel DNS kayıtları ve geçmiş sertifika kayıtları gizlenemez. Mevcut wildcard sertifikası kullanmak subdomain adına özel yeni sertifika kaydı oluşturmayı önleyebilir; tam gizlilik için genel DNS yerine özel ağ gerekir.

## Test ve sınırlar

```sh
npm test
npm audit --omit=dev
```

Testler hesap sahipliği, oturum güvenliği, token şifreleme ve Steam olaylarını taklit ederek işçi yaşam döngüsünü sınar. Gerçek Steam girişi ve saat artışı bu testlerle doğrulanmaz. Canlı kabul testi için kendi hesabınla QR girişini tamamla, tek bir oyun başlat, daha sonra Steam profilindeki süreyi karşılaştır; başka bilgisayarda oyun açıp duraklamayı da kontrol et.

Hesap kaldırmak sunucudaki tokenı siler; Steam tarafında tokenı iptal etmez. Tam iptal için Steam'deki yetkilendirilmiş cihazlar/oturumlar bölümünü kullan. Sunucu yöneticisi şifreleme anahtarına erişebildiğinden yalnızca güvendiğin sunucuda kullan. `.env`, `data/`, SQLite yedekleri ve giriş QR'larını paylaşma. Canlı SQLite veritabanını kopyalamak yerine SQLite backup aracı veya servis durdurularak tutarlı yedek al; anahtarı ayrı ve güvenli sakla.

## Kaynaklar

- [steam-user](https://github.com/DoctorMcKay/node-steam-user): istemci bağlantısı ve `gamesPlayed`.
- [steam-session](https://github.com/DoctorMcKay/node-steam-session): kendi Steam hesabın için QR onayı ve istemci oturumu tokenı.

MIT lisansı. Bağımlılıkların kendi lisansları geçerlidir.
