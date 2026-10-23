/**
 * js/achievements.js — 14 logros con i18n
 */
var ACHIEVEMENT_IDS = [
  'first_correct','streak_3','streak_5','streak_10','perfect_game','no_mistakes',
  'daily_first','daily_3','time_attack_10','time_attack_20','play_5_games',
  'play_all_modes','score_50','score_100'
];
var ACHIEVEMENT_ICONS = {
  first_correct:'🎯',streak_3:'🔥',streak_5:'🔥',streak_10:'⚡',
  perfect_game:'🏆',no_mistakes:'💎',daily_first:'📅',daily_3:'🗓️',
  time_attack_10:'⏱️',time_attack_20:'🚀',play_5_games:'🎮',
  play_all_modes:'🌍',score_50:'⭐',score_100:'👑'
};
var ACHIEVEMENT_I18N_KEYS = {
  first_correct:{n:'ach_1_name',d:'ach_1_desc'},streak_3:{n:'ach_2_name',d:'ach_2_desc'},
  streak_5:{n:'ach_3_name',d:'ach_3_desc'},streak_10:{n:'ach_4_name',d:'ach_4_desc'},
  perfect_game:{n:'ach_5_name',d:'ach_5_desc'},no_mistakes:{n:'ach_6_name',d:'ach_6_desc'},
  daily_first:{n:'ach_7_name',d:'ach_7_desc'},daily_3:{n:'ach_8_name',d:'ach_8_desc'},
  time_attack_10:{n:'ach_9_name',d:'ach_9_desc'},time_attack_20:{n:'ach_10_name',d:'ach_10_desc'},
  play_5_games:{n:'ach_11_name',d:'ach_11_desc'},play_all_modes:{n:'ach_12_name',d:'ach_12_desc'},
  score_50:{n:'ach_13_name',d:'ach_13_desc'},score_100:{n:'ach_14_name',d:'ach_14_desc'}
};

function _baseMode(mode) {
  if (typeof mode !== 'string') return null;
  if (Object.prototype.hasOwnProperty.call(MODE_I18N, mode)) return mode;
  var modes = Object.keys(MODE_I18N).sort(function (a, b) { return b.length - a.length; });
  for (var i = 0; i < modes.length; i++) {
    if (new RegExp('(^|[^A-Za-z0-9])' + modes[i] + '($|[^A-Za-z0-9])').test(mode)) return modes[i];
  }
  return null;
}

function checkAchievements(result) {
  var data=loadAchievements(), stats=data.stats, before=data.unlocked.slice();
  stats.total_correct=(stats.total_correct||0)+(result.correct||0);
  stats.total_attempted=(stats.total_attempted||0)+(result.correct||0)+(result.wrong||0);
  stats.total_games=(stats.total_games||0)+1;
  if (!stats.statsByMode || typeof stats.statsByMode !== 'object' || Array.isArray(stats.statsByMode)) stats.statsByMode={};
  var modeBase = result.isDaily ? 'daily' : _baseMode(result.mode);
  if (modeBase) {
    if (!stats.statsByMode[modeBase]) stats.statsByMode[modeBase]={games:0,correct:0,wrong:0};
    stats.statsByMode[modeBase].games += 1;
    stats.statsByMode[modeBase].correct += result.correct||0;
    stats.statsByMode[modeBase].wrong += result.wrong||0;
  }
  if (stats.modes_played.indexOf(result.mode)===-1) stats.modes_played.push(result.mode);
  if (result.mode==='timetrial') stats.max_time_attack=Math.max(stats.max_time_attack||0,result.score);
  if (result.isDaily) stats.daily_completed=(stats.daily_completed||0)+1;
  if (result.maxStreak>(stats.max_streak_ever||0)) stats.max_streak_ever=result.maxStreak;
  function u(id){ if(data.unlocked.indexOf(id)===-1) data.unlocked.push(id); }
  if (stats.total_correct>=1)           u('first_correct');
  if (result.maxStreak>=3)              u('streak_3');
  if (result.maxStreak>=5)              u('streak_5');
  if (result.maxStreak>=10)             u('streak_10');
  if (result.total>0&&result.score===result.total) u('perfect_game');
  if (result.total>=20&&result.wrong===0) u('no_mistakes');
  if (result.isDaily)                   u('daily_first');
  if ((stats.daily_completed||0)>=3)    u('daily_3');
  if (stats.max_time_attack>=10)        u('time_attack_10');
  if (stats.max_time_attack>=20)        u('time_attack_20');
  if (stats.total_games>=5)             u('play_5_games');
  if (stats.modes_played.length>=3)     u('play_all_modes');
  if (stats.total_correct>=50)          u('score_50');
  if (stats.total_correct>=100)         u('score_100');
  saveAchievements(data);
  return data.unlocked.filter(function(id){ return before.indexOf(id)===-1; });
}

function renderAchievementsScreen() {
  var grid=document.getElementById('achievement-grid');
  var prog=document.getElementById('achievements-progress-text');
  if (!grid) return;
  var data=loadAchievements(), unlocked=data.unlocked;
  if (prog) prog.textContent=t('ach_progress',{n:unlocked.length,total:ACHIEVEMENT_IDS.length});
  grid.innerHTML='';
  ACHIEVEMENT_IDS.forEach(function(id) {
    var isUnlocked=unlocked.indexOf(id)!==-1;
    var keys=ACHIEVEMENT_I18N_KEYS[id];
    var div=document.createElement('div');
    div.className='achievement-card'+(isUnlocked?' achievement-unlocked':' achievement-locked');
    div.innerHTML='<span class="ach-icon">'+(isUnlocked?ACHIEVEMENT_ICONS[id]:'🔒')+'</span>'+
      '<span class="ach-name">'+t(keys.n)+'</span>'+
      '<span class="ach-desc">'+t(keys.d)+'</span>';
    grid.appendChild(div);
  });
}

function showAchievementToast(id) {
  var keys=ACHIEVEMENT_I18N_KEYS[id]; if (!keys) return;
  var toast=document.getElementById('achievement-toast');
  var icon=document.getElementById('achievement-toast-icon');
  var name=document.getElementById('achievement-toast-name');
  var label=document.getElementById('achievement-toast-label');
  if (!toast) return;
  if (icon)  icon.textContent=ACHIEVEMENT_ICONS[id]||'🏅';
  if (name)  name.textContent=t(keys.n);
  if (label) label.textContent=t('toast_ach');
  toast.style.display='flex';
  toast.classList.remove('toast-hide'); toast.classList.add('toast-show');
  setTimeout(function(){
    toast.classList.add('toast-hide');
    setTimeout(function(){ toast.style.display='none'; toast.classList.remove('toast-show','toast-hide'); },400);
  },3000);
}

function showNewAchievements(ids) {
  if (!ids||!ids.length) return;
  FeedbackManager.onAchievement();
  var i=0;
  function next(){ if(i>=ids.length)return; showAchievementToast(ids[i++]); if(i<ids.length)setTimeout(next,3600); }
  next();
}
