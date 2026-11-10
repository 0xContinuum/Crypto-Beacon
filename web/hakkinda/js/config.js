/* Site ayarları.
 * telegram: botun adresi (Mini App buradan açılır).
 * apiUrl:   Beacon sunucusunun adresi; doluysa "Topluluk" bölümü gerçek yayıncıları ve son paylaşımları gösterir.
 * ads:      boş bırakılırsa sitede hiç reklam alanı görünmez. Ayrıntı için README "Site reklamları".
 *   Google AdSense:  { provider: 'adsense', client: 'ca-pub-XXXXXXXXXXXXXXXX', slots: { a: '1234567890', b: '0987654321' } }
 *   Başka ağ (kod):  { provider: 'html', slots: { a: '<ağın verdiği reklam kodu>', b: '<...>' } }
 */
window.SITE_CFG = {
  telegram: 'https://t.me/BeaconCrypto_Bot',
  apiUrl: '',
  ads: (window.BEACON_CONFIG && window.BEACON_CONFIG.webAds) || null,   // tek yerden: ../js/config.js > webAds
};
