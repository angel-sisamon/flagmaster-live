/**
 * js/week-utils.js — Utilidades para semanas ISO
 *
 * Módulo WeekUtils con helpers para calcular y navegar semanas ISO 8601.
 * El identificador de semana tiene el formato "YYYY-WNN" (ej: "2026-W15").
 *
 * ORDEN DE CARGA: después de js/storage.js y antes de js/countries-data.js
 */

var WeekUtils = (function () {

  /* Rellena con cero a la izquierda hasta 2 dígitos */
  function _pad2(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  /**
   * Calcula el número de semana ISO y el año ISO de una fecha.
   * La semana ISO comienza el lunes; la semana 1 es la que contiene
   * el primer jueves del año.
   *
   * @param {Date} date
   * @returns {{ year: number, week: number }}
   */
  function _isoWeekData(date) {
    /* Trabajamos en UTC para evitar problemas de zona horaria */
    var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    var day = d.getUTCDay() || 7; /* 1=lun … 7=dom */
    /* Mover al jueves de la misma semana ISO */
    d.setUTCDate(d.getUTCDate() + 4 - day);
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    var weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return { year: d.getUTCFullYear(), week: weekNo };
  }

  /**
   * Devuelve el ID de semana ISO en formato "YYYY-WNN".
   * Si no se pasa date, usa la fecha actual.
   *
   * @param {Date} [date]
   * @returns {string}  ej: "2026-W15"
   */
  function getWeekId(date) {
    var d = date ? new Date(date) : new Date(Date.now());
    var iso = _isoWeekData(d);
    return iso.year + '-W' + _pad2(iso.week);
  }

  /**
   * Dado un weekId, devuelve las fechas de inicio (lunes) y fin (domingo).
   *
   * @param {string} weekId  ej: "2026-W15"
   * @returns {{ monday: Date, sunday: Date }}
   */
  function getWeekBounds(weekId) {
    var parts = weekId.split('-W');
    var year  = parseInt(parts[0], 10);
    var week  = parseInt(parts[1], 10);

    /* El 4 de enero siempre pertenece a la semana 1 del año ISO */
    var jan4    = new Date(Date.UTC(year, 0, 4));
    var dayJan4 = jan4.getUTCDay() || 7; /* 1=lun … 7=dom */

    /* Lunes de la semana 1 */
    var week1Monday = new Date(jan4);
    week1Monday.setUTCDate(jan4.getUTCDate() - (dayJan4 - 1));

    /* Lunes de la semana solicitada */
    var monday = new Date(week1Monday);
    monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);

    /* Domingo de la semana solicitada */
    var sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);

    return { monday: monday, sunday: sunday };
  }

  /**
   * Devuelve true si hoy es lunes (inicio de nueva semana ISO).
   * Usa UTC para ser consistente con el resto del módulo.
   *
   * @returns {boolean}
   */
  function isNewWeek() {
    return new Date().getUTCDay() === 1;
  }

  /**
   * Devuelve el weekId de la semana anterior al weekId dado.
   *
   * @param {string} weekId
   * @returns {string}
   */
  function getPreviousWeekId(weekId) {
    var bounds = getWeekBounds(weekId);
    var prevMonday = new Date(bounds.monday);
    prevMonday.setUTCDate(bounds.monday.getUTCDate() - 7);
    return getWeekId(prevMonday);
  }

  /**
   * Devuelve el weekId de la semana siguiente al weekId dado.
   *
   * @param {string} weekId
   * @returns {string}
   */
  function getNextWeekId(weekId) {
    var bounds = getWeekBounds(weekId);
    var nextMonday = new Date(bounds.monday);
    nextMonday.setUTCDate(bounds.monday.getUTCDate() + 7);
    return getWeekId(nextMonday);
  }

  /* ── API pública ─────────────────────────────────────── */

  return {
    getWeekId:         getWeekId,
    getWeekBounds:     getWeekBounds,
    isNewWeek:         isNewWeek,
    getPreviousWeekId: getPreviousWeekId,
    getNextWeekId:     getNextWeekId
  };

})();
