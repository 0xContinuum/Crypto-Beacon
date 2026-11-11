/* Pine çevirici ekranı: solda Pine, sağda Beacon çıktısı; Pro özelliği (reklamla açılan Pro saati geçerlidir). */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id), P = window.BeaconPine, A = window.__beacon;
  if (!P || !A || !$('pineBtn')) return;
  let last = null;
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  $('pineBtn').onclick = () => {
    if (!A.isPro()) { A.toast('Çevirici Pro ile açılır; reklam izleyerek Pro saati kazanabilirsiniz'); A.closeSheet('fxSheet'); A.go('pro'); return; }
    A.haptic(); A.closeSheet('fxSheet'); A.openSheet('pineSheet');
  };
  $('pineClose').onclick = () => A.closeSheet('pineSheet');
  $('pineGo').onclick = () => {
    if (!A.isPro()) { A.toast('Pro süreniz bitti'); A.closeSheet('pineSheet'); A.go('pro'); return; }
    const src = $('pineIn').value; if (!src.trim()) { A.toast('Önce Pine kodunu yapıştırın'); return; }
    if (src.length > 60000) { A.toast('Kod çok uzun (en çok 60.000 karakter)'); return; }
    let res; try { res = P.convert(src); } catch (e) { A.toast('Çeviri sırasında hata: ' + e.message); return; }
    last = res; $('pineOut').value = res.code; $('pineCopy').disabled = !res.drawable; $('pineAdd').disabled = !res.drawable;
    const groups = P.groupReport(res.report), r = $('pineRep');
    r.innerHTML = `<div class="sum">✓ ${res.ok} satır çevrildi · ✗ ${res.skipped} satır atlandı</div>` + res.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join('') +
      (groups.length ? `<details><summary>Atlanan satırlar ve nedenleri</summary><ul>${groups.map((g) => `<li>${esc(g.text)} <span class="note">(satır ${g.lines.slice(0, 8).join(', ')}${g.lines.length > 8 ? '…' : ''})</span></li>`).join('')}</ul></details>` : '');
    r.hidden = false; A.haptic('ok');
  };
  $('pineCopy').onclick = async () => {
    const t = $('pineOut').value; if (!t) return;
    try { await navigator.clipboard.writeText(t); } catch (e) { $('pineOut').select(); try { document.execCommand('copy'); } catch (e2) { /* yok */ } }
    A.toast('Kopyalandı');
  };
  $('pineAdd').onclick = () => {
    if (!last || !last.drawable) return;
    const S = A.state(); S.custom = S.custom || [];
    if (S.custom.length >= 8) { A.toast('En çok 8 gösterge saklanabilir; birini silin'); return; }
    S.custom.push({ id: Date.now(), name: String(last.title).replace(/[\u0000-\u001f]/g, '').slice(0, 30) || 'Pine göstergesi', code: last.code, on: true });
    A.save(); A.fxRender(); A.applyCustom(); A.closeSheet('pineSheet'); A.toast('Gösterge grafiğe eklendi');
  };
})();
