/**
 * server/src/vtuber/vts-client.js — Conexión con la API de VTube Studio (WebSocket, puerto 8001 por defecto).
 *
 * Usa la librería ws con la compresión desactivada: con el WebSocket que trae Node, VTube Studio negocia
 * permessage-deflate y sus respuestas llegan vacías (solo se salvaba la de autenticación). Se encarga de:
 *   - Autenticarse: la primera vez pide un token y VTube Studio muestra una ventana para aprobar el plugin;
 *     el token se guarda en tokenFile y las siguientes veces entra solo.
 *   - Peticiones con respuesta: request(type, data) → Promise con el data de la respuesta (o error de la API).
 *   - Comprobar que sigue vivo (APIStateRequest cada heartbeatMs) y reconectar con espera creciente (1 s → 30 s).
 *
 * Eventos (on): 'state' (state, message)   'connecting' | 'authenticating' | 'waiting-approval' | 'connected' | 'disconnected'
 *               'ready'                    autenticado: ya se pueden mandar peticiones
 */

'use strict';

const fs = require('fs');
const EventEmitter = require('events');
const WebSocket = require('ws');

const API_NAME = 'VTubeStudioPublicAPI';
const API_VERSION = '1.0';
const APPROVAL_TIMEOUT_MS = 120000;   // lo que damos a quien emite para pulsar "Permitir" en VTube Studio

function readToken(file) {
  try { return fs.readFileSync(file, 'utf8').trim() || null; } catch { return null; }
}

function writeToken(file, token) {
  try { fs.writeFileSync(file, token); } catch (err) { console.error(`⚠️  VTuber: no se pudo guardar el token: ${err.message}`); }
}

function apiError(type, data) {
  const err = new Error(`${type}: ${(data && data.message) || 'error de la API'}`);
  err.errorID = data && data.errorID;
  return err;
}

function createVTSClient({
  url = 'ws://127.0.0.1:8001',
  pluginName = 'FlagMaster LIVE',
  pluginDeveloper = 'FlagMaster',
  tokenFile = null,
  WebSocketImpl = null,   // solo para tests: un WebSocket de mentira
  heartbeatMs = 5000,
  requestTimeoutMs = 4000,
  reconnectMs = [1000, 30000],
} = {}) {
  const events = new EventEmitter();
  const pending = new Map();   // requestID -> { resolve, reject, timer }
  const st = { ws: null, state: 'disconnected', message: '', ready: false, stopped: true, retry: null, heartbeat: null, backoff: reconnectMs[0], nextId: 1 };

  function setState(state, message) {
    st.state = state;
    st.message = message || '';
    events.emit('state', state, st.message);
  }

  function rawRequest(messageType, data, timeoutMs) {
    const ws = st.ws;
    if (!ws || ws.readyState !== 1) return Promise.reject(new Error('VTube Studio no está conectado'));
    const requestID = `fm${st.nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestID);
        reject(new Error(`${messageType}: sin respuesta de VTube Studio`));
      }, timeoutMs || requestTimeoutMs);
      pending.set(requestID, { resolve, reject, timer });
      ws.send(JSON.stringify({ apiName: API_NAME, apiVersion: API_VERSION, requestID, messageType, data: data || {} }));
    });
  }

  function onMessage(ev) {
    let msg;
    try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
    const p = msg && pending.get(msg.requestID);
    if (!p) return;   // eventos de la API (no los usamos) o respuestas que ya caducaron
    pending.delete(msg.requestID);
    clearTimeout(p.timer);
    if (msg.messageType === 'APIError') p.reject(apiError(msg.messageType, msg.data));
    else p.resolve(msg.data || {});
  }

  function rejectAll(reason) {
    for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error(reason)); }
    pending.clear();
  }

  async function authenticate() {
    setState('authenticating', 'Autenticando con VTube Studio...');
    const base = { pluginName, pluginDeveloper };
    let token = tokenFile ? readToken(tokenFile) : null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!token) {
        setState('waiting-approval', 'Pulsa "Permitir" en la ventana de VTube Studio');
        const r = await rawRequest('AuthenticationTokenRequest', base, APPROVAL_TIMEOUT_MS);
        token = r.authenticationToken;
        if (tokenFile) writeToken(tokenFile, token);
      }
      const r = await rawRequest('AuthenticationRequest', { ...base, authenticationToken: token });
      if (r.authenticated) return;
      token = null;   // token revocado o de otra instalación: se pide otro
    }
    throw new Error('VTube Studio no aceptó el token');
  }

  function scheduleReconnect(reason) {
    if (st.stopped) return;
    clearTimeout(st.retry);
    setState('disconnected', `${reason}. Reintentando en ${Math.round(st.backoff / 1000)} s...`);
    st.retry = setTimeout(connect, st.backoff);
    st.backoff = Math.min(st.backoff * 2, reconnectMs[1]);
  }

  function dropSocket(reason) {
    const ws = st.ws;
    if (!ws) return;
    st.ws = null;
    st.ready = false;
    clearInterval(st.heartbeat);
    rejectAll(reason);
    try { ws.close(); } catch { /* ya cerrado */ }
    scheduleReconnect(reason);
  }

  function connect() {
    if (st.stopped) return;
    clearTimeout(st.retry);
    setState('connecting', `Conectando con VTube Studio en ${url}...`);
    let ws;
    try { ws = WebSocketImpl ? new WebSocketImpl(url) : new WebSocket(url, { perMessageDeflate: false }); } catch (err) { return scheduleReconnect(`No se pudo abrir ${url}: ${err.message}`); }
    st.ws = ws;
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', () => { if (st.ws === ws) dropSocket('VTube Studio cerró la conexión'); });
    ws.addEventListener('error', () => { if (st.ws === ws) dropSocket('No hay conexión con VTube Studio (¿está abierto y con la API activada?)'); });
    ws.addEventListener('open', async () => {
      try {
        await authenticate();
      } catch (err) {
        if (st.ws === ws) dropSocket(err.errorID === 50 ? 'Se denegó el permiso en VTube Studio' : err.message);
        return;
      }
      if (st.ws !== ws) return;
      st.ready = true;
      st.backoff = reconnectMs[0];
      setState('connected', 'Conectado a VTube Studio');
      st.heartbeat = setInterval(() => {
        rawRequest('APIStateRequest').catch(() => { if (st.ws === ws) dropSocket('VTube Studio no responde'); });
      }, heartbeatMs);
      events.emit('ready');
    });
  }

  return {
    on: (event, fn) => events.on(event, fn),
    start() {
      if (!st.stopped) return;
      st.stopped = false;
      connect();
    },
    stop() {
      st.stopped = true;
      clearTimeout(st.retry);
      const ws = st.ws;
      st.ws = null;
      st.ready = false;
      clearInterval(st.heartbeat);
      rejectAll('cliente detenido');
      if (ws) try { ws.close(); } catch { /* ya cerrado */ }
    },
    /* Petición autenticada; falla en seguida si no hay conexión (las reacciones no esperan a VTube Studio) */
    request(messageType, data) {
      if (!st.ready) return Promise.reject(new Error('VTube Studio no está conectado'));
      return rawRequest(messageType, data);
    },
    /* Para mensajes que se mandan muchas veces por segundo (parámetros): sin esperar respuesta si no hace falta */
    send(messageType, data) {
      return this.request(messageType, data).catch(() => {});
    },
    isReady: () => st.ready,
    status: () => ({ state: st.state, message: st.message, url }),
  };
}

module.exports = { createVTSClient };
