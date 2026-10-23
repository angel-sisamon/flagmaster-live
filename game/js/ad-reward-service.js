/**
 * js/ad-reward-service.js — Servicio de recuperación de días via Rewarded Ads (stub)
 *
 * Prepara la integración con proveedores de anuncios para permitir al jugador
 * recuperar un día perdido viendo un anuncio recompensado.
 *
 * Estado actual: STUB — la funcionalidad de ads está deshabilitada
 * (adRewardEnabled: false). Solo requiere conectar el proveedor externo
 * cuando esté disponible.
 *
 * ORDEN DE CARGA: después de js/firebase-leaderboard.js y antes de js/leaderboard-ui.js
 * Depende de: storage.js, firebase-leaderboard.js
 */

var AdRewardService = (function () {

  /* Clave de localStorage para registrar recuperaciones de la semana */
  var RECOVERIES_KEY = 'ad_recoveries';

  /* Referencia al proveedor de ads (interfaz: { init, loadRewardedAd, showRewardedAd, isAdLoaded }) */
  var _provider = null;

  /* ── Configuración interna ───────────────────────────── */

  function _getConfig() {
    return {
      adRewardEnabled: false, /* Habilitar cuando se conecte el proveedor */
      maxRecoveries:   2       /* Máximo de recuperaciones por semana */
    };
  }

  /* ── Helpers de recuperaciones semanales ─────────────── */

  /**
   * Carga el registro de recuperaciones de la semana actual.
   * Devuelve { weekId, count }.
   */
  function _loadRecoveries() {
    var data = storageLoad(RECOVERIES_KEY, null);
    if (!data || typeof data !== 'object') return { weekId: null, count: 0 };
    return data;
  }

  /**
   * Guarda el registro de recuperaciones actualizado.
   * @param {string} weekId
   * @param {number} count
   */
  function _saveRecoveries(weekId, count) {
    storageSave(RECOVERIES_KEY, { weekId: weekId, count: count });
  }

  /**
   * Devuelve el número de recuperaciones usadas esta semana.
   * Si el weekId almacenado no coincide con la semana actual, reinicia a 0.
   */
  function _getWeeklyRecoveriesUsed() {
    var currentWeekId = (typeof WeekUtils !== 'undefined') ? WeekUtils.getWeekId() : null;
    var rec = _loadRecoveries();
    if (!currentWeekId || rec.weekId !== currentWeekId) return 0;
    return rec.count || 0;
  }

  /**
   * Devuelve la fecha de ayer en formato 'YYYY-MM-DD'.
   */
  function _getYesterdayKey() {
    var d = new Date();
    d.setDate(d.getDate() - 1);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  /* ── API pública ─────────────────────────────────────── */

  /**
   * Registra el proveedor de anuncios.
   * Interfaz esperada: { init, loadRewardedAd, showRewardedAd, isAdLoaded }
   *
   * @param {object} provider
   */
  function setProvider(provider) {
    _provider = provider;
    console.log('[AdRewardService] Proveedor registrado:', provider);
  }

  /**
   * Comprueba si el jugador puede recuperar el día de ayer.
   *
   * Condiciones:
   *   1. La feature está habilitada (adRewardEnabled).
   *   2. Ayer no fue jugado.
   *   3. Quedan recuperaciones disponibles esta semana.
   *
   * @returns {{ eligible: boolean, reason: string, missedDate: string, recoveriesRemaining: number }}
   */
  function canRecoverMissedDay() {
    var config = _getConfig();
    var yesterday = _getYesterdayKey();
    var recoveriesUsed      = _getWeeklyRecoveriesUsed();
    var recoveriesRemaining = Math.max(0, config.maxRecoveries - recoveriesUsed);

    /* 1. Feature deshabilitada */
    if (!config.adRewardEnabled) {
      return {
        eligible:            false,
        reason:              'feature_disabled',
        missedDate:          yesterday,
        recoveriesRemaining: recoveriesRemaining
      };
    }

    /* 2. Comprobar si ayer fue jugado */
    if (typeof loadDailyStatus === 'function') {
      var dailyStatus = loadDailyStatus();
      if (dailyStatus[yesterday]) {
        return {
          eligible:            false,
          reason:              'already_played',
          missedDate:          yesterday,
          recoveriesRemaining: recoveriesRemaining
        };
      }
    }

    /* 3. Comprobar límite de recuperaciones semanales */
    if (recoveriesRemaining <= 0) {
      return {
        eligible:            false,
        reason:              'weekly_limit_reached',
        missedDate:          yesterday,
        recoveriesRemaining: 0
      };
    }

    return {
      eligible:            true,
      reason:              'ok',
      missedDate:          yesterday,
      recoveriesRemaining: recoveriesRemaining
    };
  }

  /**
   * Solicita la reproducción del anuncio de recompensa.
   * Sin proveedor: simula éxito (modo desarrollo).
   * Con proveedor: delega en showRewardedAd().
   *
   * @returns {Promise<boolean>} true si el anuncio fue completado
   */
  function requestRecovery() {
    /* Sin proveedor — simular éxito en modo desarrollo */
    if (!_provider) {
      console.warn('[AdRewardService] Sin proveedor — simulando éxito (dev mode).');
      return Promise.resolve(true).then(function (result) {
        if (result) _registerRecovery();
        return result;
      });
    }

    /* Con proveedor — mostrar anuncio real */
    return _provider.showRewardedAd()
      .then(function (completed) {
        if (completed) _registerRecovery();
        return completed;
      })
      .catch(function (err) {
        console.warn('[AdRewardService] Error mostrando anuncio:', err);
        return false;
      });
  }

  /**
   * Registra una recuperación usada en la semana actual.
   */
  function _registerRecovery() {
    var currentWeekId = (typeof WeekUtils !== 'undefined') ? WeekUtils.getWeekId() : null;
    var rec = _loadRecoveries();
    var count = (rec.weekId === currentWeekId) ? (rec.count || 0) + 1 : 1;
    _saveRecoveries(currentWeekId, count);
    console.log('[AdRewardService] Recuperación registrada. Total esta semana:', count);
  }

  /**
   * Envía el score de un día recuperado al ranking global.
   * Verifica que la fecha sea realmente ayer antes de enviar.
   *
   * @param {string} missedDate  Fecha perdida en formato 'YYYY-MM-DD' — debe ser ayer
   * @param {number} score
   * @returns {Promise<boolean>}
   */
  function submitRecoveredScore(missedDate, score) {
    /* Salvaguarda: solo permitir enviar el día de ayer */
    if (missedDate !== _getYesterdayKey()) {
      console.warn('[AdRewardService] submitRecoveredScore bloqueado: la fecha no es ayer.', missedDate);
      return Promise.resolve(false);
    }

    if (typeof FirebaseLeaderboard === 'undefined' || !FirebaseLeaderboard.submitRecoveredDailyScore) {
      console.warn('[AdRewardService] FirebaseLeaderboard no disponible.');
      return Promise.resolve(false);
    }

    return FirebaseLeaderboard.submitRecoveredDailyScore(score, missedDate)
      .then(function (ok) {
        if (ok) {
          /* Marcar el día recuperado como completado en localStorage */
          if (typeof markDateCompleted === 'function') {
            markDateCompleted(missedDate, score);
          }
          console.log('[AdRewardService] ✓ Score recuperado enviado y marcado. Fecha:', missedDate, 'Score:', score);
        }
        return ok;
      });
  }

  /**
   * Indica si hay un anuncio cargado y listo para mostrar.
   *
   * @returns {boolean}
   */
  function isAdReady() {
    if (_provider && typeof _provider.isAdLoaded === 'function') {
      return _provider.isAdLoaded();
    }
    return false;
  }

  /* ── Retorno público ─────────────────────────────────── */

  return {
    setProvider:          setProvider,
    canRecoverMissedDay:  canRecoverMissedDay,
    requestRecovery:      requestRecovery,
    submitRecoveredScore: submitRecoveredScore,
    isAdReady:            isAdReady
  };

})();
