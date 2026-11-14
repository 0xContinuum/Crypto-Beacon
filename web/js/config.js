/* Dağıtımdan önce düzenleyin.
 * adsgramBlockId: Adsgram panelinde bu uygulama için oluşturduğunuz ÖDÜLLÜ reklam biriminin kimliği.
 *   Boş bırakılırsa reklam butonu "reklam birimi tanımlı değil" der. ?demo=1 ile sahte reklam oynatır (yalnızca test içindir).
 * apiUrl: Beacon sunucusunun adresi. Doluysa topluluk, yayıncı paneli ve sunucu doğrulamalı Pro açılır.
 * ownerIds: sahip Telegram kimlikleri. Tüm coinler ve özellikler süresiz açık, reklam gerekmez.
 * grants:   başkalarına Pro verme listesi. Örnek satır:  { id: 123456789, until: '2026-12-31', note: 'Ali' },
 *           "until" yoksa süresizdir. Satırı ekleyip GitHub'a gönderin, Render otomatik yayınlar.
 *
 * GÜVENLİK NOTU: Uygulama sunucusuz olduğu için kimlik Telegram'ın istemciden verdiği bilgiden okunur ve doğrulanmaz.
 * Teknik biliği olan biri bunu taklit edebilir. Burada kilitlenen şey değerli bir ürün değil, kolaylıktır.
 * Para karşılığı satılacak bir özellik için kimliği sunucuda imzayla doğrulamak gerekir.
 */
window.BEACON_CONFIG = {
  telegramBot: 'BeaconCrypto_Bot',   // botun kullanıcı adı (@ olmadan). Web girişi ve "Telegram'da aç" düğmesi için.
  apiUrl: 'https://crypto-beacon-hibrit.vercel.app/',   // Beacon sunucusu. Boş bırakılırsa Topluluk/Hesap görünmez (sunucusuz mod).
  // Tarayıcı sürümü (web) reklamı. null ise hiç reklam görünmez. Reklam, ziyaretçi onayından sonra yüklenir. Telegram içinde asla gösterilmez.
  //   AdSense: { provider: 'adsense', client: 'ca-pub-XXXXXXXXXXXXXXXX', slots: { a: '1234567890', b: '0987654321' } }
  //   Başka ağ: { provider: 'html', slots: { a: '<ağın verdiği kod>', b: '<...>' } }
  webAds: null,
  adsgramBlockId: '58185',      // örn. '12345'
  proMinutesPerAd: 60,
  proMaxMinutes: 360,
  adsPerDay: 6,
  ownerIds: [6394985954],
  grants: [
    // { id: 123456789, until: '2026-12-31', note: 'Örnek' },
  ],
};

/* Size özel değerler (Adsgram blok kimliği, webAds vb.) için js/config.local.js dosyası oluşturun; bu dosya varsa yukarıdaki değerlerin üzerine yazar.
 * Örnek içerik:  Object.assign(window.BEACON_CONFIG, { adsgramBlockId: '12345' });
 * Yeni sürüm yüklerken config.local.js'e dokunulmaz, ayarlarınız kaybolmaz. */
