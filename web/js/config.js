/* Dağıtımdan önce düzenleyin.
 * adsgramBlockId: Adsgram panelinde bu uygulama için oluşturduğunuz ÖDÜLLÜ reklam biriminin kimliği.
 *   Boş bırakılırsa reklam butonu "reklam birimi tanımlı değil" der. ?demo=1 ile sahte reklam oynatır (yalnızca test içindir).
 */
window.BEACON_CONFIG = {
  adsgramBlockId: '',      // örn. '12345'
  proMinutesPerAd: 30,
  proMaxMinutes: 120,
  adsPerDay: 6,
};
