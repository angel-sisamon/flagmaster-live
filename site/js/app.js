/**
 * site/js/app.js — Web de clasificaciones de FlagMaster LIVE (GitHub Pages, sin dependencias).
 *
 * Lee los JSON que genera scripts/aggregate.js en site/data/:
 *   index.json (meses) · months/AAAA-MM.json (ranking del mes) · alltime.json (histórico y récords)
 *
 * Rutas (hash):  #/  → mes actual   ·   #/m/AAAA-MM → otro mes   ·   #/p/<id>?m=AAAA-MM → ficha de jugador
 */

'use strict';

(function () {
  const t = SiteI18n.t;
  const C = SITE_CONFIG;
  const app = document.getElementById('app');
  const ME_KEY = 'fm_site_me';
  const MEDALS = ['🥇', '🥈', '🥉'];

  if (/Windows/.test(navigator.userAgent)) document.documentElement.classList.add('flag-font-fallback');

  /* ── Utilidades ─────────────────────────────────────── */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = n => new Intl.NumberFormat(SiteI18n.lang()).format(n || 0);
  const secs = ms => (ms / 1000).toLocaleString(SiteI18n.lang(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' s';
  const name = p => p.n || p.u || '?';

  function monthLabel(key) {
    const [y, m] = key.split('-').map(Number);
    const s = new Intl.DateTimeFormat(SiteI18n.lang(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, 1));
    return s.charAt(0).toUpperCase() + s.slice(1);   // 'octubre de 2026' → 'Octubre de 2026'
  }

  function dateLabel(iso, tz) {
    return new Intl.DateTimeFormat(SiteI18n.lang(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso));
  }

  function currentMonth(tz) {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(new Date());
    return p.find(x => x.type === 'year').value + '-' + p.find(x => x.type === 'month').value;
  }

  function avatar(p, cls) {
    let h = 0;
    for (const ch of String(p.id || p.u || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
    const initial = Array.from(name(p).trim())[0] || '?';
    return `<span class="avatar ${cls || ''}" style="background:linear-gradient(135deg,hsl(${h} 75% 55%),hsl(${(h + 50) % 360} 70% 42%))">${esc(initial.toUpperCase())}</span>`;
  }

  function getMe() {
    try { return localStorage.getItem(ME_KEY) || ''; } catch (e) { return ''; }
  }

  function setMe(id) {
    try { if (id) localStorage.setItem(ME_KEY, id); else localStorage.removeItem(ME_KEY); } catch (e) { /* solo esta visita */ }
  }

  const cache = {};
  function load(path) {
    if (!cache[path]) {
      cache[path] = fetch('data/' + path, { cache: 'no-cache' }).then(r => {
        if (!r.ok) throw new Error(r.status + ' ' + path);
        return r.json();
      });
      cache[path].catch(() => { delete cache[path]; });
    }
    return cache[path];
  }

  const playerLink = (p, month) => `#/p/${encodeURIComponent(p.id)}${month ? '?m=' + month : ''}`;

  /* ── Tablas del mes ─────────────────────────────────── */
  const BOARDS = {
    points: {
      hint: () => t('h_points'),
      rows: ps => ps.filter(p => p.pos > 0),
      pos: p => p.pos,
      value: p => `${nf(p.pts)} ${t('pts')}<small>${nf(p.ok)}/${nf(p.ans)} · ${p.acc}%</small>`,
    },
    accuracy: {
      hint: () => t('h_accuracy', { n: C.minAnswersAccuracy }),
      rows: ps => ps.filter(p => p.ans >= C.minAnswersAccuracy).sort((a, b) => b.acc - a.acc || b.ok - a.ok),
      value: p => `${p.acc}%<small>${nf(p.ok)}/${nf(p.ans)}</small>`,
    },
    streak: {
      hint: () => t('h_streak'),
      rows: ps => ps.filter(p => p.streak > 0).sort((a, b) => b.streak - a.streak || b.pts - a.pts),
      value: p => `🔥 ${nf(p.streak)}<small>${nf(p.pts)} ${t('pts')}</small>`,
    },
    speed: {
      hint: () => t('h_speed', { n: C.minCorrectSpeed }),
      rows: ps => ps.filter(p => p.ok >= C.minCorrectSpeed && p.avg > 0).sort((a, b) => a.avg - b.avg),
      value: p => `⚡ ${secs(p.avg)}<small>${t('p_fast')}: ${secs(p.fast)}</small>`,
    },
    loyal: {
      hint: () => t('h_loyal'),
      rows: ps => ps.filter(p => p.lives > 0).sort((a, b) => b.lives - a.lives || b.pts - a.pts),
      value: p => `${p.lives === 1 ? t('live_1') : t('lives_n', { n: p.lives })}<small>${nf(p.pts)} ${t('pts')}</small>`,
    },
    support: {
      hint: () => t('h_support'),
      rows: ps => ps.filter(p => p.gifts > 0 || p.likes > 0).sort((a, b) => b.gifts - a.gifts || b.likes - a.likes),
      value: p => `💎 ${nf(p.gifts)}<small>❤️ ${nf(p.likes)}</small>`,
    },
  };
  const state = { board: 'points', shown: C.pageSize };

  function boardHtml(data) {
    const def = BOARDS[state.board];
    const rows = def.rows(data.players.slice());
    const me = getMe();
    if (!rows.length) return `<p class="empty-note">${t('nobody')}</p>`;
    return `<p class="board-hint">${esc(def.hint())}</p><ol class="board">` + rows.slice(0, state.shown).map((p, i) => {
      const pos = def.pos ? def.pos(p) : i + 1;
      const cls = 'row' + (pos <= 3 ? ' row--' + pos : '') + (p.id === me ? ' row--me' : '');
      return `<li><a class="${cls}" href="${playerLink(p, data.month)}">
        <span class="row-pos">${pos <= 3 ? MEDALS[pos - 1] : pos}</span>
        <span class="row-who">${avatar(p)}<span class="row-names"><span class="row-nick">${esc(name(p))}</span>` +
        (p.u ? `<span class="row-handle">@${esc(p.u)}</span>` : '') + `</span></span>
        <span class="row-val">${def.value(p)}</span></a></li>`;
    }).join('') + '</ol>' +
      (rows.length > state.shown ? `<button type="button" class="more" data-more>${t('show_more')} (${nf(rows.length - state.shown)})</button>` : '');
  }

  function podiumHtml(data) {
    const top = data.players.filter(p => p.pos > 0 && p.pos <= 3);
    if (!top.length) return '';
    return '<div class="podium">' + [1, 0, 2].map(i => top[i] ? `
      <a class="place place--${i + 1}" href="${playerLink(top[i], data.month)}">
        ${i === 0 ? '<span class="crown">👑</span>' : ''}${avatar(top[i])}
        <span class="place-name">${esc(name(top[i]))}</span>
        <span class="place-pts">${nf(top[i].pts)} ${t('pts')}</span>
        <span class="place-block">${MEDALS[i]}</span>
      </a>` : '<span></span>').join('') + '</div>';
  }

  /* ── Bloques de la portada ──────────────────────────── */
  const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 2.5 14.2 12 4 21.5c-.4-.2-.6-.6-.6-1.1V3.6c0-.5.2-.9.6-1.1Z" fill="#00d4ff"/><path d="M17.6 8.8 14.2 12 4 2.5l.3-.1c.4 0 .7.1 1 .3l12.3 6.1Z" fill="#00f076"/><path d="M17.6 15.2 5.3 21.3c-.3.2-.6.3-1 .3l-.3-.1L14.2 12l3.4 3.2Z" fill="#ff3a44"/><path d="m17.6 8.8 3.1 1.6c.6.3.9.9.9 1.6s-.3 1.3-.9 1.6l-3.1 1.6-3.4-3.2 3.4-3.2Z" fill="#ffd040"/></svg>';
  const APPLE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M16.4 12.6c0-2.5 2-3.7 2.1-3.8-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.8 1.2 1.8 2.6 3.1 2.5 1.3-.1 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8 0 0-2.3-.9-2.3-4.2ZM14 5.2c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.6 2.8-1.4Z"/></svg>';

  function storesHtml() {
    const ios = C.appStoreUrl
      ? `<a class="store" data-track="download-ios" href="${esc(C.appStoreUrl)}" rel="noopener">${APPLE_ICON}<span><small>${t('play_small')}</small><b>${t('ios_big')}</b></span></a>`
      : `<span class="store store--ios" aria-disabled="true">${APPLE_ICON}<span><small>${t('ios_small')}</small><b>${t('ios_big')}</b></span><span class="store-soon">${t('soon')}</span></span>`;
    return `<div class="stores">
      <a class="store store--play" data-track="download-android" href="${esc(C.playStoreUrl)}" rel="noopener">${PLAY_ICON}<span><small>${t('play_small')}</small><b>${t('play_big')}</b></span></a>
      ${ios}</div>`;
  }

  function heroCounters(s) {
    if (!s || !s.players) return '';
    return `<p class="hero-counters"><span><b>${nf(s.players)}</b> ${t('s_players_all').toLowerCase()}</span><span><b>${nf(s.lives)}</b> ${t('s_lives').toLowerCase()}</span>` +
      (s.messages ? `<span><b>${nf(s.messages)}</b> ${t('s_messages').toLowerCase()}</span>` : `<span><b>${nf(s.answers)}</b> ${t('s_answers').toLowerCase()}</span>`) + '</p>';
  }

  function heroHtml(totals) {
    return `<section class="hero">
      <div><span class="hero-badge"><i></i>TikTok LIVE</span>
        <h1>${t('hero_title')}</h1><p>${esc(t('hero_sub'))}</p>${heroCounters(totals)}
        ${C.tiktokUser ? `<a class="hero-live" data-track="tiktok" href="https://www.tiktok.com/@${encodeURIComponent(C.tiktokUser)}/live" rel="noopener">▶ ${t('follow_live')} · @${esc(C.tiktokUser)}</a>` : ''}
      </div>${storesHtml()}</section>`;
  }

  function stat(icon, value, label) {
    return `<div class="stat"><b><i>${icon}</i>${value}</b><span>${label}</span></div>`;
  }

  const hours = min => (min / 60).toLocaleString(SiteI18n.lang(), { maximumFractionDigits: min < 600 ? 1 : 0 });
  const opt = (v, icon, label, fmt) => (v ? stat(icon, fmt ? fmt(v) : nf(v), label) : '');

  /* Cifras de un periodo (mes o histórico). Las que valen 0 no se muestran (p. ej. mensajes en directos antiguos) */
  function totalsHtml(s, alltime) {
    return `<div class="stats">
      ${stat('👥', nf(s.players), t(alltime ? 's_players_all' : 's_players'))}${alltime ? opt(s.returning, '🔁', t('s_returning')) : opt(s.newPlayers, '✨', t('s_new'))}
      ${opt(s.participants > s.players && s.participants, '🙋', t('s_participants'))}
      ${stat('📺', nf(s.lives), t('s_lives'))}${opt(s.minutes, '⏱️', t('s_hours'), hours)}
      ${opt(s.rounds, '🏳️', t('s_rounds'))}${opt(alltime && s.countries, '🌍', t('s_countries'))}
      ${opt(s.messages, '💬', t('s_messages'))}${stat('✍️', nf(s.answers), t('s_answers'))}
      ${opt(alltime && s.correct, '✅', t('s_correct'))}${stat('🎯', s.accuracy + '%', t('s_accuracy'))}
      ${opt(s.likes, '❤️', t('s_likes'))}${opt(s.gifts, '💎', t('s_gifts'))}
      ${opt(s.follows, '➕', t('s_follows'))}${opt(s.shares, '🔗', t('s_shares'))}${opt(s.peakViewers, '👀', t('s_peak'))}
    </div>`;
  }

  function statsHtml(d) {
    return `<section class="section"><h2 class="section-title">${t('stats_title')}</h2>${totalsHtml(d.totals, false)}</section>`;
  }

  /* Jugadores por mes: una barra por mes (el último, con su valor siempre visible; el resto al pasar el dedo) */
  function growthHtml(months) {
    const list = months.slice().reverse().slice(-12);
    if (list.length < 2) return '';
    const max = Math.max(...list.map(m => m.players), 1);
    const short = key => {
      const [y, m] = key.split('-').map(Number);
      return new Intl.DateTimeFormat(SiteI18n.lang(), { month: 'short', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, 1)).replace('.', '');
    };
    return `<div class="card"><h3 class="card-title">📈 ${t('growth_title')}</h3>
      <ol class="growth" aria-label="${esc(t('growth_title'))}">` + list.map((m, i) => {
      const tip = `${monthLabel(m.id)}: ${t('players_n', { n: nf(m.players) })}${m.newPlayers ? ' · ' + nf(m.newPlayers) + ' ' + t('s_new').toLowerCase() : ''} · ${m.lives === 1 ? t('live_1') : t('lives_n', { n: nf(m.lives) })}`;
      return `<li class="growth-col${i === list.length - 1 ? ' growth-col--last' : ''}" tabindex="0" title="${esc(tip)}" aria-label="${esc(tip)}">
        <span class="growth-val">${nf(m.players)}</span>
        <span class="growth-bar" style="height:${Math.max(3, Math.round(m.players / max * 100))}%"></span>
        <span class="growth-label">${esc(short(m.id))}</span></li>`;
    }).join('') + '</ol></div>';
  }

  function globalHtml(index, all) {
    const s = index.totals;
    if (!s || !s.lives) return '';
    return `<section class="section"><h2 class="section-title">🌐 ${t('global_title')}</h2>${totalsHtml(s, true)}
      <div class="grid-2" style="margin-top:16px">${growthHtml(index.months)}${all ? flagCards(all.countries, 20, true) : ''}</div></section>`;
  }

  function flagList(list, bad) {
    const lang = SiteI18n.lang();
    return '<ul class="flags">' + list.map(c => `<li class="flag-row"><span class="flag-emoji">${esc(c.flag)}</span>
      <span><span class="flag-name">${esc(c[lang] || c.en || c.code)}</span><div class="bar ${bad ? 'bar--bad' : ''}"><span style="width:${c.pct}%"></span></div></span>
      <span class="flag-pct">${c.pct}%</span></li>`).join('') + '</ul>';
  }

  /* Más difíciles y más fáciles (solo banderas con votos suficientes para que el % signifique algo) */
  function flagCards(countries, minVotes, alltime) {
    const asked = countries.filter(c => c.votes >= minVotes);
    if (asked.length < 4) return '';
    const hard = asked.slice().sort((a, b) => a.pct - b.pct || b.votes - a.votes).slice(0, 5);
    const easy = asked.slice().sort((a, b) => b.pct - a.pct || b.votes - a.votes).slice(0, 5);
    const sfx = alltime ? '_all' : '';
    return `<div class="card"><h3 class="card-title">😵 ${t('hardest' + sfx)}</h3>${flagList(hard, true)}</div>
      <div class="card"><h3 class="card-title">😎 ${t('easiest' + sfx)}</h3>${flagList(easy, false)}</div>`;
  }

  function flagsHtml(d) {
    const cards = flagCards(d.countries, 10, false);
    return cards ? `<section class="section"><h2 class="section-title">${t('flags_title')}</h2><div class="grid-2">${cards}</div></section>` : '';
  }

  function livesHtml(d, tz) {
    if (!d.lives.length) return '';
    return `<section class="section"><h2 class="section-title">${t('lives_title')}</h2><div class="card"><ul class="lives">` +
      d.lives.slice().reverse().map(l => `<li class="live"><span class="live-date">${esc(dateLabel(l.startedAt, tz))}</span>
        <span class="live-meta">${t('players_n', { n: nf(l.players) })} · ${l.accuracy}% · ${nf(l.rounds)} 🏳️${l.messages ? ' · ' + nf(l.messages) + ' 💬' : ''}</span>
        ${l.winner ? `<a class="live-win" href="${playerLink(l.winner, d.month)}">👑 ${esc(name(l.winner))} · ${nf(l.winner.pts)} ${t('pts')}</a>` : ''}</li>`).join('') +
      '</ul></div></section>';
  }

  const RECORDS = [
    ['bestLive', '🏆', r => `${nf(r.value)} ${t('pts')}`],
    ['streak', '🔥', r => nf(r.value)],
    ['fastest', '⚡', r => secs(r.value)],
    ['fastestAvg', '⏱️', r => secs(r.value)],
    ['loyal', '📅', r => t('lives_n', { n: nf(r.value) })],
    ['supporter', '💎', r => nf(r.value)],
    ['firsts', '🥇', r => nf(r.value)],
    ['chatty', '💬', r => nf(r.value)],
  ];

  function fameHtml(all) {
    if (!all || !all.champions.length) return '';
    const recs = RECORDS.filter(([k]) => all.records[k]).map(([k, icon, fmt]) => {
      const r = all.records[k];
      return `<a class="record" href="${playerLink(r)}"><span class="record-icon">${icon}</span>
        <span><small>${t('r_' + k)}</small><b>${esc(name(r))}</b><em>${fmt(r)}</em></span></a>`;
    }).join('');
    const champs = all.champions.slice().reverse().map(c => `<li><a class="champion" href="${playerLink(c, c.month)}">
      <span class="champion-month">${esc(monthLabel(c.month))}</span>${avatar(c)}<b>${esc(name(c))}</b>
      <span class="champion-pts">${nf(c.pts)} ${t('pts')}</span></a></li>`).join('');
    const top = all.players.slice(0, 10).map(p => `<li><a class="row${p.pos <= 3 ? ' row--' + p.pos : ''}${p.id === getMe() ? ' row--me' : ''}" href="${playerLink(p)}">
      <span class="row-pos">${p.pos <= 3 ? MEDALS[p.pos - 1] : p.pos}</span>
      <span class="row-who">${avatar(p)}<span class="row-names"><span class="row-nick">${esc(name(p))}</span>${p.u ? `<span class="row-handle">@${esc(p.u)}</span>` : ''}</span></span>
      <span class="row-val">${nf(p.pts)} ${t('pts')}<small>${t('lives_n', { n: p.lives })}</small></span></a></li>`).join('');
    return `<section class="section"><h2 class="section-title">🏛️ ${t('fame_title')}</h2>
      <div class="records">${recs}</div>
      <div class="grid-2" style="margin-top:16px">
        <div class="card"><h3 class="card-title">👑 ${t('champions')}</h3><ul class="champions">${champs}</ul></div>
        <div class="card"><h3 class="card-title">🌍 ${t('alltime_title')}</h3><ol class="board">${top}</ol></div>
      </div></section>`;
  }

  function ctaHtml() {
    return `<section class="section card cta"><div><h2>${t('cta_title')}</h2><p>${esc(t('cta_sub'))}</p></div>${storesHtml()}</section>`;
  }

  /* ── Buscador ───────────────────────────────────────── */
  function bindSearch(players, month) {
    const input = document.getElementById('search');
    const out = document.getElementById('search-results');
    if (!input) return;
    input.addEventListener('input', () => {
      const q = input.value.trim().replace(/^@/, '').toLowerCase();
      if (q.length < 2) { out.hidden = true; return; }
      const hits = players.filter(p => (p.u || '').toLowerCase().includes(q) || (p.n || '').toLowerCase().includes(q)).slice(0, 8);
      out.hidden = false;
      out.innerHTML = hits.length ? hits.map(p => `<li><a href="${playerLink(p, month)}">${avatar(p)}
        <span><b>${esc(name(p))}</b> ${p.u ? `<span class="row-handle">@${esc(p.u)}</span>` : ''}</span>
        <span class="row-val" style="margin-left:auto">${p.pos ? '#' + p.pos + ' · ' : ''}${nf(p.pts)} ${t('pts')}</span></a></li>`).join('')
        : `<li class="empty">${t('search_none')}</li>`;
    });
  }

  /* ── Pantallas ──────────────────────────────────────── */
  async function renderHome(index, monthParam) {
    const tz = index.timeZone;
    const now = currentMonth(tz);
    const keys = index.months.map(m => m.id);           // de más reciente a más antiguo
    const month = monthParam || now;
    const known = keys.includes(month);
    const [data, all] = await Promise.all([known ? load(`months/${month}.json`) : null, load('alltime.json').catch(() => null)]);

    // Navegación: el mes actual siempre existe aunque aún no tenga directos
    const nav = keys.includes(now) ? keys : [now].concat(keys);
    const i = nav.indexOf(month);
    const older = i > -1 && i < nav.length - 1 ? nav[i + 1] : '';
    const newer = i > 0 ? nav[i - 1] : '';

    let body;
    if (data && data.players.length) {
      body = podiumHtml(data) + `<div class="tabs" role="tablist">` + Object.keys(BOARDS).map(k =>
        `<button type="button" class="tab" role="tab" data-board="${k}" aria-selected="${k === state.board}">${t('b_' + k)}</button>`).join('') +
        `</div><div id="board">${boardHtml(data)}</div>`;
    } else {
      const last = index.months.find(m => m.id !== month && m.champion);
      body = `<p class="empty-note">${t('empty_month')}</p>` + (last ? `<p class="empty-note"><a href="${playerLink(last.champion, last.id)}">
        👑 ${t('last_champion', { month: esc(monthLabel(last.id)) })}: <b>${esc(name(last.champion))}</b> · ${nf(last.champion.pts)} ${t('pts')}</a></p>` : '');
    }

    const me = getMe();
    const mine = data && me ? data.players.find(p => p.id === me) : null;

    app.innerHTML = heroHtml(index.totals) +
      `<section class="section"><div class="search"><input id="search" type="search" autocomplete="off" placeholder="${esc(t('search_ph'))}" aria-label="${esc(t('search_ph'))}"></div>
       <ul class="search-results" id="search-results" hidden></ul>
       ${mine ? `<p style="margin:12px 0 0"><a class="row row--me" href="${playerLink(mine, month)}"><span class="row-pos">${mine.pos || '–'}</span>
         <span class="row-who">${avatar(mine)}<span class="row-names"><span class="row-nick">${esc(name(mine))}</span><span class="row-handle">${t('me_on')}</span></span></span>
         <span class="row-val">${nf(mine.pts)} ${t('pts')}</span></a></p>` : ''}</section>` +
      `<section class="section"><div class="month-nav"><h2>📅 ${esc(t('month_title', { month: monthLabel(month) }))}</h2>
        <div class="month-arrows">
          <button type="button" class="icon-btn" data-go="${older}" ${older ? '' : 'disabled'} aria-label="${t('month_prev')}">‹</button>
          <button type="button" class="icon-btn" data-go="${newer}" ${newer ? '' : 'disabled'} aria-label="${t('month_next')}">›</button>
        </div></div><div class="card">${body}</div></section>` +
      (data ? statsHtml(data) + flagsHtml(data) + livesHtml(data, tz) : '') +
      globalHtml(index, all) + fameHtml(all) + ctaHtml();

    app.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
      if (!b.dataset.go) return;
      state.shown = C.pageSize;
      location.hash = b.dataset.go === now ? '#/' : '#/m/' + b.dataset.go;
    }));
    if (data) {
      const boardBox = document.getElementById('board');
      app.querySelectorAll('[data-board]').forEach(b => b.addEventListener('click', () => {
        state.board = b.dataset.board;
        state.shown = C.pageSize;
        app.querySelectorAll('[data-board]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
        boardBox.innerHTML = boardHtml(data);
      }));
      boardBox.addEventListener('click', e => {
        if (!e.target.closest('[data-more]')) return;
        state.shown += C.pageSize;
        boardBox.innerHTML = boardHtml(data);
      });
      bindSearch(data.players, month);
    } else if (all) {
      bindSearch(all.players, '');
    }
  }

  function sparkHtml(points, labels) {
    if (!points.length) return '';
    const W = 600, H = 120, PAD = 18;
    const max = Math.max(...points, 1);
    const x = i => (points.length === 1 ? W / 2 : PAD + i * (W - PAD * 2) / (points.length - 1));
    const y = v => H - 22 - (v / max) * (H - 40);
    const line = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(points.length - 1).toFixed(1)},${H - 22} L${x(0).toFixed(1)},${H - 22} Z`;
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(t('p_progress'))}">
      <defs><linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd040" stop-opacity=".35"/><stop offset="1" stop-color="#ffd040" stop-opacity="0"/></linearGradient></defs>
      ${points.length > 1 ? `<path class="area" d="${area}"/><path class="line" d="${line}"/>` : ''}
      ${points.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4"><title>${esc(labels[i])}: ${v}</title></circle>`).join('')}
      <text x="${PAD}" y="${H - 4}">${esc(labels[0])}</text>${points.length > 1 ? `<text x="${W - PAD}" y="${H - 4}" text-anchor="end">${esc(labels[labels.length - 1])}</text>` : ''}
    </svg>`;
  }

  async function renderPlayer(index, id, monthParam) {
    const tz = index.timeZone;
    const month = monthParam || currentMonth(tz);
    const hasMonth = index.months.some(m => m.id === month);
    const [data, all] = await Promise.all([hasMonth ? load(`months/${month}.json`) : null, load('alltime.json').catch(() => null)]);
    const p = data && data.players.find(x => x.id === id);
    const h = all && all.players.find(x => x.id === id);
    const who = p || h;
    if (!who) {
      app.innerHTML = `<a class="back" href="#/">${t('back')}</a><p class="empty-note">${t('p_not_found')}</p>`;
      return;
    }
    const me = getMe() === id;
    const back = month === currentMonth(tz) ? '#/' : '#/m/' + month;

    let monthBlock = '';
    if (p) {
      const modes = Object.entries(p.modes || {}).map(([m, v]) => {
        const pc = v[0] ? Math.round(v[1] / v[0] * 100) : 0;
        return `<div class="mode-row"><div><span>${esc(t('mode_' + m))}</span><div class="bar"><span style="width:${pc}%"></span></div></div>
          <b class="flag-pct">${pc}%</b></div>`;
      }).join('');
      const labels = p.hist.map(([i]) => dateLabel(data.lives[i].startedAt, tz));
      monthBlock = `<section class="section"><h2 class="section-title">📅 ${t('p_month')} · ${esc(monthLabel(month))}</h2>
        <div class="stats">
          ${stat('🏅', p.pos ? '#' + p.pos : '–', t('p_pos'))}${stat('⭐', nf(p.pts), t('p_points'))}${stat('🎯', p.acc + '%', t('p_acc'))}
          ${stat('🔥', nf(p.streak), t('p_streak'))}${p.avg ? stat('⏱️', secs(p.avg), t('p_avg')) : ''}${p.fast ? stat('⚡', secs(p.fast), t('p_fast')) : ''}
          ${stat('📺', nf(p.lives), t('p_lives'))}${stat('🥇', nf(p.first), t('p_first'))}
          ${p.likes ? stat('❤️', nf(p.likes), t('s_likes')) : ''}${p.gifts ? stat('💎', nf(p.gifts), t('s_gifts')) : ''}
          ${p.msgs ? stat('💬', nf(p.msgs), t('s_messages')) : ''}
        </div>
        <div class="grid-2" style="margin-top:16px">
          ${p.hist.length ? `<div class="card"><h3 class="card-title">📈 ${t('p_progress')}</h3>${sparkHtml(p.hist.map(x => x[1]), labels)}</div>` : ''}
          ${modes ? `<div class="card"><h3 class="card-title">🧩 ${t('p_modes')}</h3><div class="modes">${modes}</div></div>` : ''}
        </div></section>`;
    }

    let allBlock = '';
    if (h) {
      const months = Object.entries(h.months).sort((a, b) => b[0].localeCompare(a[0]));
      allBlock = `<section class="section"><h2 class="section-title">🌍 ${t('p_alltime')}</h2><div class="stats">
          ${stat('🏅', '#' + h.pos, t('p_pos'))}${stat('⭐', nf(h.pts), t('p_points'))}${stat('🎯', h.acc + '%', t('p_acc'))}
          ${stat('🔥', nf(h.streak), t('p_streak'))}${stat('📺', nf(h.lives), t('p_lives'))}${stat('🏆', nf(h.best), t('r_bestLive'))}
          ${stat('🥇', nf(h.first), t('p_first'))}${h.msgs ? stat('💬', nf(h.msgs), t('s_messages')) : ''}
        </div>
        ${months.length ? `<div class="card" style="margin-top:16px"><h3 class="card-title">🗓️ ${t('p_history')}</h3><ul class="champions">` +
          months.map(([m, [pts, pos]]) => `<li><a class="champion" href="${playerLink(h, m)}"><span class="champion-month">${esc(monthLabel(m))}</span>
            <b>${pos ? (pos <= 3 ? MEDALS[pos - 1] : '#' + pos) : '–'}</b><span class="champion-pts">${nf(pts)} ${t('pts')}</span></a></li>`).join('') +
          '</ul></div>' : ''}</section>`;
    }

    app.innerHTML = `<a class="back" href="${back}">${t('back')}</a>
      <div class="profile-head">${avatar(who)}<div><h1>${esc(name(who))}</h1>
        ${who.u ? `<a class="handle" href="https://www.tiktok.com/@${encodeURIComponent(who.u)}" rel="noopener nofollow">@${esc(who.u)}</a>` : ''}</div>
        <button type="button" class="me-btn" id="me-btn" aria-pressed="${me}">${me ? '✓ ' + t('me_on') : t('me_btn')}</button></div>` +
      monthBlock + allBlock + ctaHtml();

    document.getElementById('me-btn').addEventListener('click', e => {
      const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
      setMe(on ? id : '');
      e.currentTarget.setAttribute('aria-pressed', String(on));
      e.currentTarget.textContent = on ? '✓ ' + t('me_on') : t('me_btn');
    });
  }

  /* ── Visitas (GoatCounter, opcional: SITE_CONFIG.goatcounter) ──
   * Sin cookies ni datos personales. Cuenta cada pantalla (#/, #/m/…, #/p/…) y los clics en las tiendas y en TikTok. */
  const analytics = (function () {
    let ready = false;
    const routePath = () => '/' + (location.hash.replace(/^#\/?/, '').split('?')[0] || '');
    const count = vars => { if (ready && window.goatcounter && window.goatcounter.count) window.goatcounter.count(vars); };
    if (C.goatcounter) {
      const s = document.createElement('script');
      s.async = true;
      s.src = 'https://gc.zgo.at/count.js';
      s.dataset.goatcounter = `https://${C.goatcounter}.goatcounter.com/count`;
      s.dataset.goatcounterSettings = '{"no_onload": true}';
      s.onload = () => { ready = true; count({ path: routePath() }); };
      document.head.appendChild(s);
      document.addEventListener('click', e => {
        const a = e.target.closest('[data-track]');
        if (a) count({ path: a.dataset.track, title: a.textContent.trim().replace(/\s+/g, ' '), event: true });
      });
    }
    return { view: () => count({ path: routePath() }) };
  })();

  /* ── Arranque y rutas ───────────────────────────────── */
  function renderChrome(index) {
    document.documentElement.lang = SiteI18n.lang();
    document.querySelectorAll('[data-lang]').forEach(b => b.classList.toggle('active', b.dataset.lang === SiteI18n.lang()));
    document.getElementById('footer-cmd').innerHTML = t('rank_cmd');
    document.getElementById('footer-optout').innerHTML = t('optout');
    document.getElementById('footer-meta').textContent = index
      ? t('updated', { date: new Intl.DateTimeFormat(SiteI18n.lang(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(index.generatedAt)) })
      : '';
  }

  async function route() {
    let index;
    try {
      index = await load('index.json');
    } catch (e) {
      renderChrome(null);
      app.innerHTML = `<p class="empty-note">${t('error')}</p>`;
      return;
    }
    renderChrome(index);
    const [path, query] = location.hash.replace(/^#/, '').split('?');
    const params = new URLSearchParams(query || '');
    const parts = path.split('/').filter(Boolean);
    try {
      if (parts[0] === 'p' && parts[1]) await renderPlayer(index, decodeURIComponent(parts[1]), params.get('m'));
      else await renderHome(index, parts[0] === 'm' && /^\d{4}-\d{2}$/.test(parts[1]) ? parts[1] : '');
    } catch (e) {
      console.error(e);
      app.innerHTML = `<p class="empty-note">${t('error')}</p>`;
    }
  }

  document.querySelectorAll('[data-lang]').forEach(b => b.addEventListener('click', () => { SiteI18n.set(b.dataset.lang); route(); }));
  let lastPath = '';
  window.addEventListener('hashchange', () => {
    const path = location.hash.split('?')[0];
    if (path.startsWith('#/p/') || lastPath.startsWith('#/p/')) window.scrollTo(0, 0);
    lastPath = path;
    route();
    analytics.view();
  });
  lastPath = location.hash.split('?')[0];
  route();
})();
