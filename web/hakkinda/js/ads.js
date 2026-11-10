/* Reklam alanları: SITE_CFG.ads boşsa hiçbir şey yapılmaz. Reklam, ziyaretçi onay verdikten sonra yüklenir. */
(function () {
  'use strict';
  const cfg = (window.SITE_CFG || {}).ads; if (!cfg || !cfg.slots) return;
  const slots = [...document.querySelectorAll('.adslot')].filter((el) => cfg.slots[el.dataset.slot]); if (!slots.length) return;
  const KEY = 'bcn_ads_consent', box = document.getElementById('consent');
  let state = null; try { state = localStorage.getItem(KEY); } catch (e) {}
  function load() {
    if (cfg.provider === 'adsense' && cfg.client) {
      const s = document.createElement('script'); s.async = true; s.crossOrigin = 'anonymous';
      s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(cfg.client); document.head.appendChild(s);
      slots.forEach((el) => {
        el.innerHTML = '<small>Reklam</small>'; const ins = document.createElement('ins'); ins.className = 'adsbygoogle'; ins.style.display = 'block';
        ins.setAttribute('data-ad-client', cfg.client); ins.setAttribute('data-ad-slot', cfg.slots[el.dataset.slot]); ins.setAttribute('data-ad-format', 'auto'); ins.setAttribute('data-full-width-responsive', 'true');
        el.appendChild(ins); el.classList.add('on'); try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
      });
    } else if (cfg.provider === 'html') {
      slots.forEach((el) => { el.innerHTML = '<small>Reklam</small>'; const d = document.createElement('div'); d.appendChild(document.createRange().createContextualFragment(cfg.slots[el.dataset.slot])); el.appendChild(d); el.classList.add('on'); });
    }
  }
  const set = (v) => { try { localStorage.setItem(KEY, v); } catch (e) {} box.classList.remove('on'); if (v === 'yes') load(); };
  document.getElementById('cOk').onclick = () => set('yes'); document.getElementById('cNo').onclick = () => set('no');
  if (state === 'yes') load(); else if (state !== 'no') box.classList.add('on');
})();
