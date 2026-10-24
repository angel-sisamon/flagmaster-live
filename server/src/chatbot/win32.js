/**
 * server/src/chatbot/win32.js — Preguntas a Windows (user32) para saber si el clic en Studio ha servido.
 *
 *   windowAt(x, y)     ventana principal que hay bajo ese punto (¿está Studio ahí o lo tapa otra?)
 *   foreground()       ventana activa (tras el clic debería ser Studio)
 *   threadFocus(win)   control con el foco y cursor de texto (caret) en el hilo de esa ventana
 *   msSinceLastInput() cuánto hace que se tocó el ratón o el teclado (el envío automático espera si estás usando el PC)
 *   isElevated(pid)    ¿ese proceso es administrador? Windows (UIPI) descarta el ratón y el teclado simulados de un
 *                      programa normal hacia uno de administrador: Studio como admin = el clic no le llega
 *
 * Cada ventana: { hwnd, title, className, pid, exe }. Studio es Electron (Chromium): no expone la caja de chat a
 * la accesibilidad de Windows, así que "Studio activo + foco en su contenido" es lo más que se puede comprobar; el
 * caret de Chromium es orientativo. Fuera de Windows o sin koffi, load() devuelve null y no se comprueba nada.
 */

'use strict';

let api;   // undefined = sin cargar · null = no disponible

function load() {
  if (api !== undefined) return api;
  api = null;
  if (process.platform !== 'win32') return api;
  let koffi;
  try { koffi = require('koffi'); } catch { return api; }

  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const advapi32 = koffi.load('advapi32.dll');
  const HWND = koffi.pointer('FM_HWND', koffi.opaque());
  const POINT = koffi.struct('FM_POINT', { x: 'long', y: 'long' });
  const RECT = koffi.struct('FM_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
  const LASTINPUTINFO = koffi.struct('FM_LASTINPUTINFO', { cbSize: 'uint32', dwTime: 'uint32' });
  const GUITHREADINFO = koffi.struct('FM_GUITHREADINFO', {
    cbSize: 'uint32', flags: 'uint32',
    hwndActive: 'void *', hwndFocus: 'void *', hwndCapture: 'void *', hwndMenuOwner: 'void *',
    hwndMoveSize: 'void *', hwndCaret: 'void *', rcCaret: RECT,
  });

  const fn = {
    GetForegroundWindow: user32.func('FM_HWND __stdcall GetForegroundWindow()'),
    WindowFromPoint: user32.func('FM_HWND __stdcall WindowFromPoint(FM_POINT p)'),
    GetAncestor: user32.func('FM_HWND __stdcall GetAncestor(FM_HWND h, uint32 flags)'),
    GetClassNameW: user32.func('int __stdcall GetClassNameW(void *h, _Out_ uint16_t *buf, int n)'),
    GetWindowTextW: user32.func('int __stdcall GetWindowTextW(FM_HWND h, _Out_ uint16_t *buf, int n)'),
    GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(FM_HWND h, _Out_ uint32_t *pid)'),
    IsIconic: user32.func('bool __stdcall IsIconic(FM_HWND h)'),
    GetGUIThreadInfo: user32.func('bool __stdcall GetGUIThreadInfo(uint32 tid, _Inout_ FM_GUITHREADINFO *info)'),
    OpenProcess: kernel32.func('void * __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)'),
    QueryFullProcessImageNameW: kernel32.func('bool __stdcall QueryFullProcessImageNameW(void *h, uint32 flags, _Out_ uint16_t *buf, _Inout_ uint32_t *size)'),
    CloseHandle: kernel32.func('bool __stdcall CloseHandle(void *h)'),
    GetLastInputInfo: user32.func('bool __stdcall GetLastInputInfo(_Inout_ FM_LASTINPUTINFO *info)'),
    GetTickCount: kernel32.func('uint32 __stdcall GetTickCount()'),
    OpenProcessToken: advapi32.func('bool __stdcall OpenProcessToken(void *h, uint32 access, _Out_ void **token)'),
    GetTokenInformation: advapi32.func('bool __stdcall GetTokenInformation(void *token, int cls, _Out_ uint32_t *info, uint32 len, _Out_ uint32_t *ret)'),
  };
  const TOKEN_QUERY = 0x0008;
  const TOKEN_ELEVATION = 20;
  const GA_ROOT = 2;
  const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const GUI_CARETBLINKING = 0x1;

  const wide = (call, n = 512) => {
    const buf = Buffer.alloc(n * 2);
    const len = call(buf, n);
    return buf.toString('utf16le', 0, Math.max(0, len) * 2);
  };

  function exeOf(pid) {
    const h = fn.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (!h) return '';
    try {
      const buf = Buffer.alloc(1024);
      const size = [512];
      return fn.QueryFullProcessImageNameW(h, 0, buf, size) ? buf.toString('utf16le', 0, size[0] * 2).split('\\').pop() : '';
    } finally { fn.CloseHandle(h); }
  }

  function describe(hwnd) {
    if (!hwnd) return null;
    const pid = [0];
    const tid = fn.GetWindowThreadProcessId(hwnd, pid);
    return {
      hwnd,
      id: koffi.address(hwnd),
      tid,
      pid: pid[0],
      exe: exeOf(pid[0]),
      title: wide((b, n) => fn.GetWindowTextW(hwnd, b, n)),
      className: wide((b, n) => fn.GetClassNameW(hwnd, b, n)),
      minimized: fn.IsIconic(hwnd),
    };
  }

  /* true / false; si ni siquiera deja leer su token es que es de administrador (y nosotros no) */
  function isElevated(pid) {
    const h = fn.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (!h) return null;
    try {
      const token = [null];
      if (!fn.OpenProcessToken(h, TOKEN_QUERY, token)) return true;
      try {
        const value = [0];
        return fn.GetTokenInformation(token[0], TOKEN_ELEVATION, value, 4, [0]) ? !!value[0] : null;
      } finally { fn.CloseHandle(token[0]); }
    } finally { fn.CloseHandle(h); }
  }

  api = {
    isElevated,
    msSinceLastInput() {
      const info = { cbSize: koffi.sizeof(LASTINPUTINFO), dwTime: 0 };
      return fn.GetLastInputInfo(info) ? (fn.GetTickCount() - info.dwTime) >>> 0 : Infinity;
    },
    windowAt: (x, y) => describe(fn.GetAncestor(fn.WindowFromPoint({ x, y }), GA_ROOT)),
    foreground: () => describe(fn.GetForegroundWindow()),
    threadFocus(win) {
      const info = { cbSize: koffi.sizeof(GUITHREADINFO) };
      if (!win || !fn.GetGUIThreadInfo(win.tid, info)) return null;
      return {
        focusClass: info.hwndFocus ? wide((b, n) => fn.GetClassNameW(info.hwndFocus, b, n)) : '',
        caret: !!info.hwndCaret || !!(info.flags & GUI_CARETBLINKING),
      };
    },
  };
  return api;
}

// Por el ejecutable: el título no vale (la consola de probar_studio.bat también se llama "...TikTok LIVE Studio")
const isStudio = win => !!win && /tiktok\s*live\s*studio/i.test(win.exe || '');
const label = win => (win ? `"${win.title || win.className}" (${win.exe || 'pid ' + win.pid})` : 'ninguna ventana');

module.exports = { load, isStudio, label };
