/**
 * js/ui.js — Renderizado DOM. Emojis 100% offline. i18n integrado.
 */
var OPTION_BADGES=['A','B','C','D'];
var _CIRC=2*Math.PI*18;
var _DAILY_SCORE_ANIM_MS=2000;

/* ── Screens ──────────────────────────────────────── */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function(s) {
    var isT=s.id==='screen-'+name;
    s.classList.toggle('active',isT);
    if (isT){ s.classList.add('entering'); setTimeout(function(){s.classList.remove('entering');},450); }
  });
  if (name === 'game' || name === 'results') {
    if (typeof FeedbackManager !== 'undefined') FeedbackManager.onScreenTransition();
  }
}

/* ── HUD ──────────────────────────────────────────── */
function updateHUD(score, streak, currentIndex, total) {
  var se=document.getElementById('hud-score');
  var st=document.getElementById('hud-streak');
  var pt=document.getElementById('hud-progress-text');
  var pb=document.getElementById('progress-bar');
  if (se){se.textContent=score;addTempClass(se,'pop',400);}
  if (st){st.textContent=streak;if(streak>=3)addTempClass(st.closest('.hud-stat'),'burst',500);}
  if (pt) pt.textContent=(currentIndex+1)+'/'+total;
  if (pb) pb.style.width=(((currentIndex+1)/total)*100)+'%';
}
function setTimeAttackHUD(enabled) {
  var gt=document.getElementById('hud-global-timer');
  var pt=document.getElementById('hud-progress-text');
  if (gt) gt.style.display=enabled?'flex':'none';
  if (pt) pt.style.display=enabled?'none':'block';
}
function updateGlobalTimer(secs) {
  var el=document.getElementById('hud-global-timer-val'); if (!el) return;
  el.textContent=secs;
  el.classList.toggle('timer-critical',secs<=10);
  if (secs<=10) { if (typeof FeedbackManager !== 'undefined') FeedbackManager.onCountdownTick(); else AudioFX.tick(); }
}
function updateHUDScoreOnly(score, streak) {
  var se=document.getElementById('hud-score');
  var st=document.getElementById('hud-streak');
  var pb=document.getElementById('progress-bar');
  if (se){se.textContent=score;addTempClass(se,'pop',400);}
  if (st){st.textContent=streak;if(streak>=3)addTempClass(st.closest('.hud-stat'),'burst',500);}
  if (pb) pb.style.width=Math.min(100,((score%10)/10)*100)+'%';
}

/* ── Pregunta ─────────────────────────────────────── */
function renderQuestion(question, mode, animate, onAnswer) {
  var flipper=document.getElementById('card-flipper');
  var flagDisp=document.getElementById('flag-display');
  var flagWrap=document.getElementById('flag-img-wrap');
  var cntryDisp=document.getElementById('country-display');
  var cntryLbl=document.getElementById('country-name-label');
  var optGrid=document.getElementById('options-grid');
  var card=document.getElementById('question-card');
 
  if (flipper) flipper.classList.remove('flipped');
  document.getElementById('feedback-bar').style.display='none';
  document.getElementById('btn-next').style.display='none';
  document.getElementById('btn-next').textContent=t('game_next');
 
  if (animate&&card){ card.classList.remove('slide-in'); void card.offsetWidth; card.classList.add('slide-in'); }
 
  if (mode==='guess-country'||mode==='timetrial'||mode==='daily') {
    /* Bandera grande → el jugador elige el nombre del país */
    if(flagDisp) { flagDisp.style.display='flex'; flagDisp.style.flexDirection='column'; flagDisp.style.gap='.4rem'; }
    if(cntryDisp) cntryDisp.style.display='none';
    if(flagWrap) flagWrap.innerHTML='<div class="flag-capital-question">'+t('game_country_prompt')+'</div>'+
      '<span class="flag-emoji-lg">'+question.correct.flag+'</span>';
  } else if (mode==='guess-silhouette') {
    /* Silueta del país en el mapa → el jugador elige el nombre del país */
    if(flagDisp) { flagDisp.style.display='flex'; flagDisp.style.flexDirection='column'; flagDisp.style.gap='.4rem'; }
    if(cntryDisp) cntryDisp.style.display='none';
    if(flagWrap) {
      flagWrap.innerHTML='<div class="silhouette-box">'+
        '<div class="flag-capital-question">'+t('game_silhouette_prompt')+'</div>'+
        '<div class="silhouette-figure" id="silhouette-box"></div>'+
      '</div>';
      var box=document.getElementById('silhouette-box');
      if (box && typeof Silhouette !== 'undefined') {
        var svg = Silhouette.buildCountrySvg(question.correct.code, { ariaLabel: cn(question.correct) });
        if (svg) box.appendChild(svg);
        else box.textContent='—';
      }
    }
  } else if (mode==='guess-capital') {
    /* Pregunta con nombre del país → bandera debajo en tamaño medio */
    if(flagDisp) { flagDisp.style.display='flex'; flagDisp.style.flexDirection='column'; flagDisp.style.gap='.55rem'; }
    if(cntryDisp) cntryDisp.style.display='none';
    if(flagWrap) flagWrap.innerHTML=
      '<div class="flag-capital-question">'+t('game_capital_prompt',{country:cn(question.correct)})+'</div>'+
      '<span class="flag-emoji-md">'+question.correct.flag+'</span>';
  } else if (mode==='guess-country-from-capital') {
    /* Nombre de la capital → el jugador elige el país */
    if(flagDisp) flagDisp.style.display='none';
    if(cntryDisp) cntryDisp.style.display='flex';
    if(cntryLbl) cntryLbl.textContent=cap(question.correct);
    var promptC=document.getElementById('country-prompt-label');
    if(promptC) promptC.textContent=t('game_country_from_capital_prompt');
  } else {
    /* guess-flag: nombre del país → el jugador elige la bandera */
    if(flagDisp) flagDisp.style.display='none';
    if(cntryDisp) cntryDisp.style.display='flex';
    if(cntryLbl) cntryLbl.textContent=cn(question.correct);
    var prompt=document.getElementById('country-prompt-label');
    if(prompt) prompt.textContent=t('game_flag_prompt');
  }
 
  optGrid.innerHTML='';
  for (var i=0;i<question.options.length;i++) optGrid.appendChild(_optBtn(question.options[i],i,mode,onAnswer));
}

function _optBtn(option, idx, mode, onAnswer) {
  var btn=document.createElement('button');
  btn.className='option-btn';
  btn.dataset.index=idx;
  var badge='<span class="option-badge">'+OPTION_BADGES[idx]+'</span>';
  if (mode==='guess-flag') {
    /* Opciones: emoji de bandera */
    btn.innerHTML=badge+'<span class="option-flag-emoji">'+option.flag+'</span>';
  } else if (mode==='guess-capital') {
    /* Opciones: nombre de la capital */
    btn.innerHTML=badge+'<span class="option-text">'+cap(option)+'</span>';
  } else if (mode==='guess-country-from-capital') {
    /* Opciones: bandera pequeña inline + nombre del país */
    btn.innerHTML=badge+'<span class="option-flag-inline">'+option.flag+'</span><span class="option-text">'+cn(option)+'</span>';
  } else {
    /* guess-country, timetrial, daily, review: nombre del país */
    btn.innerHTML=badge+'<span class="option-text">'+cn(option)+'</span>';
  }
  btn.addEventListener('click', function () { onAnswer(idx); }, { once:true });
  return btn;
}

/* ── Feedback + flip card ─────────────────────────── */
function showAnswerFeedback(isCorrect, selectedIndex, correctIndex, correctCountry, mode) {
  document.querySelectorAll('.option-btn').forEach(function(btn,i) {
    btn.disabled=true;
    if (i===correctIndex) btn.classList.add('correct');
    else if (i===selectedIndex&&!isCorrect) btn.classList.add('wrong');
    else btn.classList.add('dimmed');
  });
  var fb=document.getElementById('feedback-bar');
  var fi=document.getElementById('feedback-icon');
  var ft=document.getElementById('feedback-text');
  fb.style.display='flex'; fb.className='feedback-bar';
  if (isCorrect) {
    fb.classList.add('correct-feedback'); fi.textContent='✅';
    ft.textContent=t('correct_'+(Math.floor(Math.random()*7)+1));
  } else {
    fb.classList.add('wrong-feedback'); fi.textContent='❌';
    if (mode==='guess-capital') {
      ft.textContent=t('wrong_capital_was')+cap(correctCountry);
    } else {
      ft.textContent=t('wrong_was')+correctCountry.flag+' '+cn(correctCountry);
    }
  }
  /* Flip card reveal */
  var revealEl=document.getElementById('reveal-content');
  if (revealEl) {
    if (mode==='guess-capital') {
      /* Muestra bandera + nombre del país + su capital */
      revealEl.innerHTML='<span class="flag-emoji-reveal">'+correctCountry.flag+'</span>'+
        '<div class="reveal-name">'+cn(correctCountry)+'</div>'+
        '<div class="reveal-capital">'+cap(correctCountry)+'</div>';
    } else {
      revealEl.innerHTML='<span class="flag-emoji-reveal">'+correctCountry.flag+'</span>'+
        '<div class="reveal-name">'+cn(correctCountry)+'</div>';
    }
  }
  setTimeout(function(){
    var flipper=document.getElementById('card-flipper');
    if (flipper) flipper.classList.add('flipped');
  },320);
  var next=document.getElementById('btn-next');
  if (next) { next.textContent=t('game_next'); next.style.display='flex'; }
}

/* ── Timer ────────────────────────────────────────── */
function updateTimerUI(remaining, total) {
  var circle=document.getElementById('timer-circle');
  var text=document.getElementById('timer-text');
  var cont=document.getElementById('timer-container');
  var urgent=remaining<=5;
  if (circle) {
    if (remaining === total) {
      /* Inicio: mostrar círculo lleno sin animación */
      circle.style.transition = 'none';
      circle.style.strokeDashoffset = 0;
      /* Forzar reflow para aplicar sin transición, luego restaurar */
      void circle.offsetWidth;
      circle.style.transition = '';
    }
    /* Animar hacia la posición del siguiente segundo (remaining-1)
       para que la transición CSS de 1s coincida con el tick del setInterval */
    var visualRemaining = Math.max(remaining - 1, 0);
    circle.style.strokeDashoffset = _CIRC - (visualRemaining / total) * _CIRC;
    circle.classList.toggle('urgent', urgent);
  }
  if (text) text.textContent=remaining;
  if (cont) cont.classList.toggle('urgent',urgent);
}
function setTimerVisible(v) { var el=document.getElementById('timer-container'); if(el) el.style.display=v?'flex':'none'; }

/* ── Resultados ───────────────────────────────────── */
function renderResults(score, total, correct, wrong, maxStreak, isNewRecord, isDaily, mode) {
  var isTA=mode==='timetrial';
  /* El porcentaje siempre se basa en aciertos/preguntas, nunca en puntos/total
     para evitar valores absurdos como 19373% cuando la puntuación es en pts */
  var pct=total>0?(correct/total)*100:0;
  var trophy=document.getElementById('results-trophy');
  var title=document.getElementById('results-title');
  var sub=document.getElementById('results-subtitle');
  if (trophy) trophy.textContent=pct===100?'🏆':pct>=80?'🥇':pct>=60?'🥈':pct>=40?'🥉':'🎮';
  if (title) {
    if (isTA) title.textContent=score>=20?t('results_ta_super'):score>=10?t('results_ta_great'):t('results_ta_ok');
    else title.textContent=pct===100?t('results_perfect_title'):pct>=80?t('results_great_title'):pct>=60?t('results_good_title'):pct>=40?t('results_ok_title'):t('results_bad_title');
  }
  if (sub) {
    if (isTA) sub.textContent=t('results_ta_sub');
    else sub.textContent=pct===100?t('results_perfect_sub'):t('results_pct_sub',{pct:Math.round(pct)});
  }
  var scoreNumEl=document.getElementById('results-score-num');
  if (scoreNumEl) {
    if (isDaily) {
      scoreNumEl.textContent='0';
      _animateDailyScore(scoreNumEl, score, _DAILY_SCORE_ANIM_MS);
    } else {
      scoreNumEl.textContent=score;
    }
  }
  /* Denominador: timetrial → hits, todo lo demás → pts (ya no hay sistema /15) */
  document.getElementById('results-score-denom').textContent=isTA?t('ranking_hits'):' pts';
  document.getElementById('res-correct').textContent=correct;
  document.getElementById('res-correct-label').textContent=t('results_correct');
  document.getElementById('res-wrong').textContent=wrong;
  document.getElementById('res-wrong-label').textContent=t('results_wrong');
  document.getElementById('res-streak').textContent=maxStreak;
  document.getElementById('res-streak-label').textContent=t('results_streak');
  var rec=document.getElementById('results-new-record');
  if (rec) rec.style.display=isNewRecord?'block':'none';
  if (rec) rec.textContent=t('results_new_record');
  var db=document.getElementById('results-daily-badge');
  if (db) db.style.display=isDaily?'block':'none';
  if (db) db.textContent=t('results_daily_done');
  var ws=document.getElementById('results-weekly-summary');
  if (ws) ws.style.display='none';
  var retryBtn=document.getElementById('btn-retry');
  if (retryBtn) { retryBtn.textContent=t('btn_retry'); retryBtn.style.display=isDaily?'none':'flex'; }
  document.getElementById('btn-home').textContent=t('btn_home');
}

/**
 * Anima el contador de puntuación del reto diario desde 0 hasta targetValue.
 * @param {HTMLElement} el          Elemento donde mostrar el número.
 * @param {number}      targetValue Valor final.
 * @param {number}      durationMs  Duración total de la animación en milisegundos.
 */
function _animateDailyScore(el, targetValue, durationMs) {
  var startTime = null;
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function step(timestamp) {
    if (!startTime) startTime = timestamp;
    var elapsed  = timestamp - startTime;
    var progress = Math.min(elapsed / durationMs, 1);
    el.textContent = Math.round(targetValue * easeOut(progress));
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function renderResultsAchievements(ids) {
  var wrap=document.getElementById('results-achievements');
  var list=document.getElementById('results-achievements-list');
  if (!wrap||!list) return;
  if (!ids||!ids.length){wrap.style.display='none';return;}
  list.innerHTML='';
  var keys=ACHIEVEMENT_I18N_KEYS;
  ids.forEach(function(id) {
    if (!keys[id]) return;
    var span=document.createElement('span');
    span.className='result-ach-badge';
    span.textContent=(ACHIEVEMENT_ICONS[id]||'🏅')+' '+t(keys[id].n);
    list.appendChild(span);
  });
  document.querySelector('#results-achievements .results-achievements-title').textContent=t('results_ach_title');
  wrap.style.display='block';
}

function renderHomeBestScore(score) {
  var el=document.getElementById('home-best-score');
  if (el) el.textContent=score>0?score:'—';
}

/* ── Compartir resultado ──────────────────────────────────── */
function shareResult(score, total, isTA, isDaily, mode) {
  var isMarathon = mode === 'marathon';
  var emoji = isMarathon ? '🏃'
    : isTA
    ? (score>=20?'🚀':score>=10?'⚡':'🎮')
    : (score===total?'🏆':score/total>=0.8?'🥇':score/total>=0.6?'🥈':'🥉');
  var modeStr = isTA ? t('mode_time_attack') : isDaily ? t('mode_daily') : (mode ? getModeDisplayName(mode) : '');
  /* Todos los modos no-timetrial muestran puntos (pts), ya no existe el sistema /total;
     la Maratón muestra la racha */
  var scoreStr = isMarathon ? (score+' 🔥') : isTA ? (score+t('ranking_hits')) : (score+' pts');
  var title = 'FlagMaster ' + emoji;
  /* URL de descarga de la app (centralizada en ShareLinks; fallback a Play Store). */
  var _shareUrl = (window.ShareLinks && typeof window.ShareLinks.getShareUrl === 'function')
    ? window.ShareLinks.getShareUrl({ type: 'app' })
    : 'https://play.google.com/store/apps/details?id=com.sisapicasso.flagmaster';
  var text = scoreStr+(modeStr?' — '+modeStr:'')+'\n'+t('share_challenge')+'\n'+_shareUrl;

  /* 1. Capacitor Share plugin — nativo Android/iOS, abre share sheet real */
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share) {
    window.Capacitor.Plugins.Share.share({
      title: title,
      text:  title + '\n' + text,
      dialogTitle: t('share_dialog_title')
    }).catch(function(){});
    return;
  }

  /* 2. Fallback — copiar al portapapeles + toast (por si el plugin no está instalado) */
  var toastMsg = t('share_copied');
  var fullText = title + '\n' + text;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(fullText).then(function() { _showCopyToast(toastMsg); }).catch(function(){});
  } else {
    /* último fallback: execCommand para WebViews antiguos */
    try {
      var ta = document.createElement('textarea');
      ta.value = fullText; ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      _showCopyToast(toastMsg);
    } catch(e) {}
  }
}

function _showCopyToast(msg) { showInfoToast('📋', msg, 2000); }

/* ── Estrellas del jugador (barra superior de la home) ── */

/**
 * Pinta las estrellas en la píldora de la barra superior. Punto de enganche del
 * futuro sistema de estrellas: basta con llamarla cada vez que cambie el saldo.
 * @param {number}  n
 * @param {boolean} [animate]  pequeño "pop" del icono (al ganar estrellas)
 */
function setHomeStars(n, animate) {
  var box = document.getElementById('home-stars');
  var val = document.getElementById('home-stars-val');
  if (!box || !val) return;
  var stars = Math.max(0, Math.floor(Number(n) || 0));
  /* Compacto a partir de 10.000 (12,3 k) para que la píldora no crezca */
  val.textContent = stars >= 10000
    ? new Intl.NumberFormat(getLang(), { notation: 'compact', maximumFractionDigits: 1 }).format(stars)
    : stars.toLocaleString(getLang());
  box.dataset.stars = stars;
  box.setAttribute('aria-label', t('home_stars_aria', { n: stars }));
  if (animate) addTempClass(box, 'pop', 450);
}

/** Repinta el último saldo (cambio de idioma: formato y aria-label). */
function refreshHomeStars() {
  var box = document.getElementById('home-stars');
  if (box) setHomeStars(box.dataset.stars || 0);
}

/** Aviso breve reutilizando el toast de logros (copiar, "pulsa atrás otra vez para salir"…). */
var _infoToastTimer = null;
function showInfoToast(iconText, msg, ms) {
  var toastEl = document.getElementById('achievement-toast');
  var icon    = document.getElementById('achievement-toast-icon');
  var name    = document.getElementById('achievement-toast-name');
  var label   = document.getElementById('achievement-toast-label');
  if (!toastEl) return;
  if (icon)  icon.textContent  = iconText || '';
  if (name)  name.textContent  = msg;
  if (label) label.textContent = '';
  clearTimeout(_infoToastTimer);
  toastEl.style.display = 'flex';
  toastEl.classList.remove('toast-hide'); toastEl.classList.add('toast-show');
  _infoToastTimer = setTimeout(function(){
    toastEl.classList.add('toast-hide');
    setTimeout(function(){ toastEl.style.display='none'; toastEl.classList.remove('toast-show','toast-hide'); }, 400);
  }, ms || 2000);
}

/* ── Modal salir ──────────────────────────────────── */

/*
 * Guardamos la referencia al callback de cancelar activo.
 * Esto permite cerrar el modal desde fuera (tecla Escape / botón Back de Android
 * en Capacitor) garantizando que los timers del juego se reanudan correctamente.
 */
var _quitModalCancel = null;

/**
 * Muestra el modal de confirmación para abandonar la partida.
 * Limpia automáticamente cualquier listener de una apertura anterior
 * para evitar acumulación de callbacks (bug en back button + reabrir).
 *
 * @param {Function}  onConfirm  Callback al confirmar.
 * @param {Function}  onCancel   Callback al cancelar.
 * @param {Object}   [opts]      Opciones opcionales de texto.
 * @param {string}   [opts.titleKey]   Clave i18n del título (por defecto 'quit_title').
 * @param {string}   [opts.bodyKey]    Clave i18n del cuerpo (por defecto 'quit_body').
 */
function showQuitModal(onConfirm, onCancel, opts) {
  /* Si hay una sesión anterior sin cerrar (p.ej. back button de Android),
     la cancelamos limpiamente antes de abrir una nueva. */
  if (_quitModalCancel) { _quitModalCancel(); }

  var modal = document.getElementById('modal-quit');
  var ok    = document.getElementById('btn-quit-confirm');
  var no    = document.getElementById('btn-quit-cancel');
  var titleKey = (opts && opts.titleKey) || 'quit_title';
  var bodyKey  = (opts && opts.bodyKey)  || 'quit_body';
  document.getElementById('quit-modal-title').textContent = t(titleKey);
  document.getElementById('quit-modal-body').textContent  = t(bodyKey);
  ok.textContent = t('btn_quit');
  no.textContent = t('btn_cancel');

  function cleanup() {
    modal.style.display = 'none';
    ok.removeEventListener('click', hOk);
    no.removeEventListener('click', hNo);
    modal.removeEventListener('click', hOverlay);
    _quitModalCancel = null;
  }
  function hOk()       { cleanup(); if (onConfirm) onConfirm(); }
  function hNo()       { cleanup(); if (onCancel)  onCancel();  }
  /* Cerrar también al tocar fuera del panel (consistente con otros modales) */
  function hOverlay(e) { if (e.target === modal) hNo(); }

  _quitModalCancel = hNo;
  ok.addEventListener('click', hOk);
  no.addEventListener('click', hNo);
  modal.addEventListener('click', hOverlay);
  modal.style.display = 'flex';
}

/**
 * Cierra el modal de salida desde fuera (tecla Escape, botón Back de Android).
 * Invoca el callback de cancelar, lo que reanuda los timers del juego.
 */
function closeQuitModal() {
  if (_quitModalCancel) {
    _quitModalCancel(); /* → cleanup() + onCancel() → _resumeTimers() */
  } else {
    /* Fallback por si el modal estaba visible pero sin callback activo */
    var modal = document.getElementById('modal-quit');
    if (modal) modal.style.display = 'none';
  }
}

/* ── Modal info reto diario ───────────────────────── */

/**
 * Muestra el popup informativo del reto diario antes de empezar.
 * @param {Function} onPlay  Callback al pulsar "Jugar".
 */
function showDailyInfoModal(onPlay) {
  var modal      = document.getElementById('modal-daily-info');
  var btnPlay    = document.getElementById('btn-daily-info-play');
  var cbNoSee    = document.getElementById('daily-info-nosee-check');
  if (!modal || !btnPlay) { if (onPlay) onPlay(); return; }

  /* Traducir contenido */
  document.getElementById('daily-info-title').textContent      = t('daily_info_title');
  document.getElementById('daily-info-how-title').textContent  = t('daily_info_how');
  document.getElementById('daily-info-how-body').textContent   = t('daily_info_how_body');
  document.getElementById('daily-info-score-title').textContent = t('daily_info_score');
  document.getElementById('daily-info-score-body').textContent  = t('daily_info_score_body');
  document.getElementById('daily-info-time-body').textContent  = t('daily_info_time');
  document.getElementById('daily-info-nosee-label').textContent = t('daily_info_nosee');
  btnPlay.textContent = t('daily_info_play');

  if (cbNoSee) cbNoSee.checked = false;

  function cleanup() {
    modal.style.display = 'none';
    btnPlay.removeEventListener('click', hPlay);
    modal.removeEventListener('click', hOverlay);
  }
  function hPlay() {
    if (cbNoSee && cbNoSee.checked) { storageSave('daily_info_suppressed', true); }
    cleanup();
    if (onPlay) onPlay();
  }
  function hOverlay(e) { if (e.target === modal) { cleanup(); } }

  btnPlay.addEventListener('click', hPlay);
  modal.addEventListener('click', hOverlay);
  modal.style.display = 'flex';
}

/* ── Modal informativo genérico (Torneos, Duelos, etc.) ─── */

/**
 * Muestra un modal informativo genérico reutilizable.
 * @param {object} opts
 * @param {string}   opts.title       Título del modal.
 * @param {Array}    opts.rows        Array de { icon, title, body }.
 * @param {string}   opts.closeLabel  Texto del botón Cerrar.
 */
function showInfoModal(opts) {
  var MODAL_ID = 'modal-info-generic';
  var modal = document.getElementById(MODAL_ID);
  if (!modal) {
    modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
  }

  var rowsHtml = (opts.rows || []).map(function (r) {
    return '<div class="daily-info-row">' +
      '<span class="daily-info-row-icon">' + (r.icon || '') + '</span>' +
      '<div class="daily-info-row-text">' +
        (r.title ? '<span class="daily-info-row-title">' + r.title + '</span>' : '') +
        '<span class="daily-info-row-body">' + (r.body || '') + '</span>' +
      '</div>' +
    '</div>';
  }).join('');

  modal.innerHTML =
    '<div class="modal-panel card">' +
      '<div class="modal-header">' +
        '<h3 class="modal-title">' + (opts.title || '') + '</h3>' +
      '</div>' +
      '<div class="modal-body">' + rowsHtml + '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-primary" id="btn-info-modal-close" data-back>' + (opts.closeLabel || 'Cerrar') + '</button>' +
      '</div>' +
    '</div>';

  modal.style.display = 'flex';

  function cleanup() {
    modal.style.display = 'none';
    modal.removeEventListener('click', hOverlay);
  }
  function hOverlay(e) { if (e.target === modal) { cleanup(); } }

  /* Asegurar que solo haya un listener de overlay activo */
  modal.removeEventListener('click', modal._infoOverlayHandler || function () {});
  modal._infoOverlayHandler = hOverlay;
  document.getElementById('btn-info-modal-close').addEventListener('click', cleanup);
  modal.addEventListener('click', hOverlay);
}
