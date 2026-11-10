#!/bin/sh
# Uygulamadaki ortak hesap dosyalarını siteye kopyalar (engine, data, market). Değiştirdikten sonra çalıştırın.
cd "$(dirname "$0")/.." && cp web/js/engine.js web/js/data.js web/js/market.js site/js/ && echo "site/js güncellendi"
