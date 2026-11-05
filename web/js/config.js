/* Dağıtımdan önce düzenleyin.
 * adsgramBlockId: Adsgram panelinde bu uygulama için oluşturduğunuz ÖDÜLLÜ reklam biriminin kimliği.
 *   Boş bırakılırsa reklam butonu "reklam birimi tanımlı değil" der. ?demo=1 ile sahte reklam oynatır (yalnızca test içindir).
 * ownerIds: sahip Telegram kimlikleri. Tüm coinler ve özellikler süresiz açık, reklam gerekmez.
 * grants:   başkalarına Pro verme listesi. Örnek satır:  { id: 123456789, until: '2026-12-31', note: 'Ali' },
 *           "until" yoksa süresizdir. Satırı ekleyip GitHub'a gönderin, Render otomatik yayınlar.
 *
 * GÜVENLİK NOTU: Uygulama sunucusuz olduğu için kimlik Telegram'ın istemciden verdiği bilgiden okunur ve doğrulanmaz.
 * Teknik biliği olan biri bunu taklit edebilir. Burada kilitlenen şey değerli bir ürün değil, kolaylıktır.
 * Para karşılığı satılacak bir özellik için kimliği sunucuda imzayla doğrulamak gerekir.
 */
window.BEACON_CONFIG = {
  adsgramBlockId: '58185',      // örn. '12345'
  proMinutesPerAd: 30,
  proMaxMinutes: 120,
  adsPerDay: 6,
  ownerIds: [6394985954],
  grants: [
    // { id: 123456789, until: '2026-12-31', note: 'Örnek' },
  ],
};
