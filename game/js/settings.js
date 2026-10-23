/**
 * js/settings.js
 *
 * CAMBIOS v4.1:
 *  - Selector de continente integrado en el modal de ajustes
 */
function getChipValue(id) { var a=document.querySelector('#'+id+' .chip.active'); return a?a.dataset.value:null; }
function setChipActive(id, v) { document.querySelectorAll('#'+id+' .chip').forEach(function(c){c.classList.toggle('active',c.dataset.value===v);}); }
/* La app es siempre oscura: se ignora el argumento (se mantiene la firma por compatibilidad). */
function applyDarkMode(dark) {
  document.body.classList.add('dark');
  document.body.classList.remove('light');
}

function getSystemDarkMode() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function syncSettingsUI(s) {
  setChipActive('chips-questions',String(s.numQuestions));
  setChipActive('chips-timer',String(s.timerDuration));
  var tt=document.getElementById('toggle-timer'),ts=document.getElementById('toggle-sound'),
      tv=document.getElementById('toggle-vibration');
  if(tt)tt.checked=!!s.timerEnabled; if(ts)ts.checked=!!s.soundEnabled;
  if(tv)tv.checked=!!s.vibration;
  var g=document.getElementById('group-timer-duration');
  if(g)g.style.display=s.timerEnabled?'flex':'none';
  setChipActive('chips-lang', getLang ? getLang() : 'es');
  var contSel = document.getElementById('continent-select');
  if (contSel) {
    var saved = (typeof storageLoad === 'function') ? storageLoad('last_continent', 'all') : 'all';
    contSel.value = saved || 'all';
  }
}

function readSettingsUI() {
  return {
    numQuestions:  Number(getChipValue('chips-questions')||10),
    timerEnabled:  !!(document.getElementById('toggle-timer')||{}).checked,
    timerDuration: Number(getChipValue('chips-timer')||15),
    soundEnabled:  !!(document.getElementById('toggle-sound')||{}).checked,
    vibration:     !!(document.getElementById('toggle-vibration')||{}).checked,
    darkMode:      true, /* tema claro eliminado: siempre oscuro */
  };
}

function showSettingsModal(s) { syncSettingsUI(s); document.getElementById('modal-settings').style.display='flex'; }
function hideSettingsModal()   { document.getElementById('modal-settings').style.display='none'; }


function initSettingsEvents(onSaved) {
  if(!supportsVibration()){ var gv=document.getElementById('group-vibration'); if(gv)gv.style.display='none'; }

  document.querySelectorAll('.chip-group').forEach(function(g){
    g.querySelectorAll('.chip').forEach(function(c){
      c.addEventListener('click',function(){
        g.querySelectorAll('.chip').forEach(function(x){x.classList.remove('active');});
        c.classList.add('active');
      });
    });
  });

  var langGroup = document.getElementById('chips-lang');
  if (langGroup) {
    langGroup.querySelectorAll('.chip').forEach(function(c){
      c.addEventListener('click', function(){
        langGroup.querySelectorAll('.chip').forEach(function(x){x.classList.remove('active');});
        c.classList.add('active');
      });
    });
  }

  var tt=document.getElementById('toggle-timer');
  if(tt)tt.addEventListener('change',function(){
    var gd=document.getElementById('group-timer-duration');
    if(gd)gd.style.display=this.checked?'flex':'none';
  });

  var continentInfoBtn = document.getElementById('btn-continent-info');
  if (continentInfoBtn) {
    continentInfoBtn.addEventListener('click', function () {
      alert(typeof t === 'function' ? t('settings_continent_info') : '');
    });
  }

  document.getElementById('btn-save-settings').addEventListener('click',function(){
    var s=readSettingsUI(); saveSettings(s); hideSettingsModal();
    var langChip = document.querySelector('#chips-lang .chip.active');
    if (langChip && typeof setLang === 'function') setLang(langChip.dataset.lang);
    var contSel = document.getElementById('continent-select');
    if (contSel && typeof storageSave === 'function') {
      storageSave('last_continent', contSel.value);
    }
    if(typeof onSaved==='function')onSaved(s);
  });
  document.getElementById('btn-close-settings').addEventListener('click',hideSettingsModal);
  document.getElementById('modal-settings').addEventListener('click',function(e){ if(e.target===this)hideSettingsModal(); });
}
