/**
 * js/insights.js — Motor de insights estadísticos pluggable.
 *
 * Para añadir un nuevo insight, registra un objeto en INSIGHT_GENERATORS
 * con { id, icon, generate(wrongV2, ranking) } sin tocar ningún otro código.
 *
 * Depende de: storage.js (getFailureRateByMode, _loadWrongCountriesV2 via storageLoad),
 *             i18n.js (t()), modes.js (getModeDisplayName)
 */

/* eslint-disable no-unused-vars */

var INSIGHT_GENERATORS = [
  /* ── Modo más difícil (mayor ratio fallos totales) ──────── */
  {
    id: 'hardest_mode',
    icon: '🎯',
    generate: function (wrongV2, ranking) {
      var byMode = getFailureRateByMode();
      var modes = Object.keys(byMode).filter(function (m) { return m !== '_legacy' && m !== '_unknown'; });
      if (!modes.length) return null;

      /* Contar partidas por modo desde el ranking local */
      var gamesByMode = {};
      (ranking || []).forEach(function (e) {
        gamesByMode[e.mode] = (gamesByMode[e.mode] || 0) + 1;
      });

      /* Calcular ratio fallos/partidas para cada modo */
      var best = null;
      modes.forEach(function (mode) {
        var games = gamesByMode[mode] || 0;
        if (!games) return;
        var ratio = byMode[mode] / games;
        if (!best || ratio > best.ratio) {
          best = { mode: mode, ratio: ratio };
        }
      });

      if (!best) return null;
      var pct = Math.round(best.ratio * 100);
      return {
        icon: '🎯',
        text: t('stats_hardest_mode', { mode: getModeDisplayName(best.mode), pct: pct })
      };
    }
  },

  /* ── Tendencia semanal (últimos 7 días vs 7 anteriores) ─── */
  {
    id: 'weekly_trend',
    icon: '📈',
    generate: function (wrongV2) {
      var today = new Date();
      var todayKey = today.getFullYear() + '-' +
        String(today.getMonth() + 1).padStart(2, '0') + '-' +
        String(today.getDate()).padStart(2, '0');

      /* Generar claves de los últimos 14 días */
      function keyForOffset(offset) {
        var d = new Date(today);
        d.setDate(d.getDate() - offset);
        return d.getFullYear() + '-' +
          String(d.getMonth() + 1).padStart(2, '0') + '-' +
          String(d.getDate()).padStart(2, '0');
      }

      var recentKeys = [];
      var prevKeys = [];
      for (var i = 0; i < 7; i++) recentKeys.push(keyForOffset(i));
      for (var j = 7; j < 14; j++) prevKeys.push(keyForOffset(j));

      var codes = Object.keys(wrongV2);
      if (!codes.length) return null;

      /* Sum total failures (across all modes) for entries whose lastSeen falls within the window */
      function countInWindow(keys) {
        var total = 0;
        codes.forEach(function (code) {
          var entry = wrongV2[code];
          if (!entry || !entry.lastSeen) return;
          if (keys.indexOf(entry.lastSeen) !== -1) total += (entry.total || 1);
        });
        return total;
      }

      var recentCount = countInWindow(recentKeys);
      var prevCount   = countInWindow(prevKeys);
      var diff = prevCount - recentCount;

      if (diff > 0) {
        return { icon: '📈', text: t('stats_weekly_better', { n: diff }) };
      } else if (diff < 0) {
        return { icon: '📉', text: t('stats_weekly_worse', { n: -diff }) };
      }
      return null;
    }
  },

  /* ── Pares confusos (países más fallados en guess-flag) ─── */
  {
    id: 'confused_pairs',
    icon: '🔀',
    generate: function (wrongV2) {
      var flagMode = 'guess-flag';
      var arr = Object.keys(wrongV2).map(function (code) {
        var entry = wrongV2[code];
        var count = (entry && entry.byMode && entry.byMode[flagMode]) ? entry.byMode[flagMode] : 0;
        return { code: code, count: count };
      }).filter(function (x) { return x.count >= 2; });

      arr.sort(function (a, b) { return b.count - a.count; });
      if (arr.length < 2) return null;

      var a = arr[0].code;
      var b = arr[1].code;

      /* Obtener nombre del país si COUNTRIES está disponible */
      function countryName(code) {
        if (typeof COUNTRIES !== 'undefined' && typeof cn === 'function') {
          var found = null;
          for (var i = 0; i < COUNTRIES.length; i++) {
            if (COUNTRIES[i].code === code) { found = COUNTRIES[i]; break; }
          }
          if (found) return cn(found);
        }
        return code;
      }

      return {
        icon: '🔀',
        text: t('stats_confused_pair', { a: countryName(a), b: countryName(b) })
      };
    }
  },

  /* ── País más mejorado (menor lastSeen reciente con historial) */
  {
    id: 'most_improved',
    icon: '⬆️',
    generate: function (wrongV2) {
      var today = new Date();

      /* Países con total >= 3 y lastSeen hace más de 14 días (ya no los fallas) */
      var threshold = new Date(today);
      threshold.setDate(threshold.getDate() - 14);
      var threshKey = threshold.getFullYear() + '-' +
        String(threshold.getMonth() + 1).padStart(2, '0') + '-' +
        String(threshold.getDate()).padStart(2, '0');

      var candidates = Object.keys(wrongV2).filter(function (code) {
        var entry = wrongV2[code];
        return entry && entry.total >= 3 && entry.lastSeen && entry.lastSeen < threshKey;
      });

      if (!candidates.length) return null;

      /* El candidato con más fallos totales pero que lleva más tiempo sin verse */
      candidates.sort(function (a, b) {
        return wrongV2[b].total - wrongV2[a].total;
      });

      var best = candidates[0];

      function countryName(code) {
        if (typeof COUNTRIES !== 'undefined' && typeof cn === 'function') {
          for (var i = 0; i < COUNTRIES.length; i++) {
            if (COUNTRIES[i].code === code) return cn(COUNTRIES[i]);
          }
        }
        return code;
      }

      return {
        icon: '⬆️',
        text: t('stats_most_improved', { country: countryName(best) })
      };
    }
  }
];

/**
 * Ejecuta todos los generadores y retorna los que producen resultado.
 * @returns {{ icon:string, text:string }[]}
 */
function generateInsights() {
  var wrongV2 = storageLoad('wrong_countries_v2', {});
  if (!wrongV2 || typeof wrongV2 !== 'object') wrongV2 = {};
  var ranking = (typeof loadRanking === 'function') ? loadRanking() : [];
  return INSIGHT_GENERATORS.map(function (gen) {
    try { return gen.generate(wrongV2, ranking); }
    catch (e) { return null; }
  }).filter(Boolean);
}
