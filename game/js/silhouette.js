/**
 * js/silhouette.js — Modo "Adivinar país por su silueta".
 *
 * Carga (una sola vez, cache en memoria) `assets/world.svg` y expone
 * utilidades para renderizar la silueta de un país aislada en un <svg>
 * autónomo con viewBox ajustado a su bounding box.
 *
 * Estructura del SVG fuente (simplemaps world.svg):
 *   - Un solo <svg viewBox="0 0 2400 1200"> con ~437 <path> de países /
 *     subdivisiones y ~451 <path> de fronteras (fill="none").
 *   - Cada path de país lleva `data-country="XX"` o `data-country="XX-YY"`
 *     donde XX es el código ISO 3166-1 alpha-2. Los paths de frontera
 *     llevan `data-border1`/`data-border2` y NO llevan `data-country`.
 *   - Convenciones observadas:
 *       · Países pequeños  → un único <path> con id = alpha-2 (p.ej. "DE", "FR").
 *       · Grandes/islas    → varios paths con sufijos: "-ML" (mainland),
 *         "-HI" (Hawaii), "-AK-ML" (Alaska mainland), "-IB" (Baleares), etc.
 *
 * API pública:
 *   Silhouette.preload()               → Promise<SVGSVGElement>
 *   Silhouette.hasSilhouetteFor(iso)   → boolean
 *   Silhouette.getAvailableCodes()     → Set<string>
 *   Silhouette.buildCountrySvg(iso, opts)   → SVGSVGElement | null
 *   Silhouette.focusCountry(svg, iso, opts) → { ok, viewBox, bbox } | { ok:false }
 *
 * Depende de: nada.
 */
(function (global) {
  'use strict';

  var SVG_URL = 'assets/world.svg';
  var SVG_NS  = 'http://www.w3.org/2000/svg';

  /* ── Cache ─────────────────────────────────────────── */
  var _loadPromise    = null;   // Promise<SVGSVGElement>
  var _worldSvg       = null;   // SVGSVGElement raíz (offscreen, sólo para consultas)
  var _availableCodes = null;   // Set<string> alpha-2 disponibles

  /* ── Constantes de encuadre ────────────────────────── */
  var DEFAULT_PAD          = 0.18;  // 18% de margen alrededor de la bbox
  var MAX_FRACTION_OF_WORLD= 0.55;  // países cuya bbox unida excede este % del mundo
                                    // se recortan al mayor sub-path (mainland)
  var CONTAINER_ASPECT     = 4 / 3; // aspect ratio por defecto del contenedor

  /**
   * Carga y parsea el SVG del mundo. Idempotente y memoizada.
   * @returns {Promise<SVGSVGElement>}
   */
  function preload() {
    if (_loadPromise) return _loadPromise;
    _loadPromise = fetch(SVG_URL, { cache: 'force-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('world.svg HTTP ' + r.status);
        return r.text();
      })
      .then(function (text) {
        var parser = new DOMParser();
        var doc    = parser.parseFromString(text, 'image/svg+xml');
        var svg    = doc.documentElement;
        if (!svg || svg.nodeName.toLowerCase() !== 'svg') {
          throw new Error('world.svg: root no es <svg>');
        }
        _worldSvg = svg;
        _availableCodes = _buildAvailabilityIndex(svg);
        return svg;
      })
      .catch(function (err) {
        _loadPromise = null; // permite reintentar
        throw err;
      });
    return _loadPromise;
  }

  /**
   * Indexa los códigos alpha-2 presentes al menos una vez como país
   * (excluye paths de frontera, que carecen de data-country).
   */
  function _buildAvailabilityIndex(svg) {
    var set   = new Set();
    var paths = svg.querySelectorAll('path[data-country]');
    for (var i = 0; i < paths.length; i++) {
      var dc = paths[i].getAttribute('data-country');
      if (!dc) continue;
      var head = dc.split('-')[0];
      if (head.length === 2) set.add(head);
    }
    return set;
  }

  /**
   * @param {string} iso alpha-2 (p.ej. 'ES')
   * @returns {boolean}
   */
  function hasSilhouetteFor(iso) {
    if (!_availableCodes || !iso) return false;
    return _availableCodes.has(String(iso).toUpperCase());
  }

  function getAvailableCodes() {
    return _availableCodes ? new Set(_availableCodes) : new Set();
  }

  /**
   * Selecciona los <path> del país (todas sus subdivisiones/islas).
   * @param {SVGSVGElement} svg
   * @param {string} iso alpha-2
   * @returns {SVGPathElement[]}
   */
  function _selectCountryPaths(svg, iso) {
    var code = String(iso).toUpperCase();
    // Coincide con "XX" exacto o cualquier "XX-*". Excluye siempre los paths
    // de frontera (no llevan data-country, sólo data-border1/2).
    var sel = 'path[data-country="' + code + '"],' +
              'path[data-country^="' + code + '-"]';
    var nodes = svg.querySelectorAll(sel);
    var out = [];
    for (var i = 0; i < nodes.length; i++) out.push(nodes[i]);
    return out;
  }

  /**
   * Une varias bboxes en una sola caja envolvente.
   * @param {DOMRect[]} boxes
   * @returns {{x:number,y:number,width:number,height:number}|null}
   */
  function _unionBBox(boxes) {
    if (!boxes.length) return null;
    var minX =  Infinity, minY =  Infinity;
    var maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      if (!b || !isFinite(b.width) || !isFinite(b.height)) continue;
      if (b.width === 0 && b.height === 0) continue;
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.width  > maxX) maxX = b.x + b.width;
      if (b.y + b.height > maxY) maxY = b.y + b.height;
    }
    if (!isFinite(minX)) return null;
    return { x:minX, y:minY, width:maxX-minX, height:maxY-minY };
  }

  function _pickMainlandIndex(paths, boxes, iso) {
    var exactIdx = -1;
    var exactArea = 0;
    var best = 0;
    var bestIdx = -1;
    for (var i = 0; i < paths.length; i++) {
      var box = boxes[i];
      var area = box.width * box.height;
      if (area > best) {
        best = area;
        bestIdx = i;
      }
      if (paths[i].getAttribute('data-country') !== iso) continue;
      if (area > exactArea) {
        exactArea = area;
        exactIdx = i;
      }
    }
    if (exactIdx >= 0 && exactArea >= best * 0.5) return exactIdx;
    return bestIdx;
  }

  /**
   * getBBox() requiere que el nodo esté en el árbol renderizado.
   * El SVG cacheado vive offscreen, así que clonamos temporalmente
   * el path en un SVG oculto adjuntado al <body> para medirlo.
   * Cache por nodo para evitar mediciones repetidas.
   */
  var _bboxCache = new WeakMap();
  function _measure(pathNode) {
    var cached = _bboxCache.get(pathNode);
    if (cached) return cached;

    var host = document.createElementNS(SVG_NS, 'svg');
    host.setAttribute('width', '0');
    host.setAttribute('height', '0');
    host.setAttribute('style', 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;');
    var clone = pathNode.cloneNode(false); // sin hijos (los <path> son vacíos)
    host.appendChild(clone);
    document.body.appendChild(host);
    var bbox;
    try { bbox = clone.getBBox(); }
    catch (_e) { bbox = { x:0, y:0, width:0, height:0 }; }
    document.body.removeChild(host);

    var rect = { x:bbox.x, y:bbox.y, width:bbox.width, height:bbox.height };
    _bboxCache.set(pathNode, rect);
    return rect;
  }

  /**
   * Devuelve el viewBox del SVG raíz {x,y,width,height} o null.
   */
  function _rootViewBox(svg) {
    var vb = svg.viewBox && svg.viewBox.baseVal;
    if (vb && vb.width > 0 && vb.height > 0) {
      return { x:vb.x, y:vb.y, width:vb.width, height:vb.height };
    }
    return null;
  }

  /**
   * Calcula el viewBox de encuadre a partir de una bbox base:
   *  - añade `pad` proporcional
   *  - ajusta al aspect ratio del contenedor (sin deformar la silueta)
   *  - evita viewBoxes mínimos absolutos: el suelo se calcula a partir de la
   *    propia bbox para que los microestados no se conviertan en un punto
   *
   * @param {{x,y,width,height}} bbox
   * @param {number} containerAspect  ancho/alto
   * @param {number} pad              fracción (0.18 = 18%)
   * @returns {{x,y,width,height}}
   */
  function _computeFramedViewBox(bbox, containerAspect, pad) {
    var minSide = Math.max(bbox.width, bbox.height);
    var w = Math.max(bbox.width,  minSide);
    var h = Math.max(bbox.height, minSide);
    var bboxAspect = bbox.width / bbox.height;
    w *= (1 + 2 * pad);
    h *= (1 + 2 * pad);

    // Países de aspect ratio extremo (RU, CL, NO, NZ...) letterboxean mejor
    // con preserveAspectRatio="xMidYMid meet" que forzando el contenedor.
    var extreme = bboxAspect > 2.5 || bboxAspect < 0.4;
    if (!extreme) {
      var boxAspect = w / h;
      if (boxAspect < containerAspect) {
        w = h * containerAspect;
      } else {
        h = w / containerAspect;
      }
    }

    var cx = bbox.x + bbox.width  / 2;
    var cy = bbox.y + bbox.height / 2;
    return { x: cx - w/2, y: cy - h/2, width: w, height: h };
  }

  function _resolvePad(bbox, world, explicitPad) {
    if (typeof explicitPad === 'number') return explicitPad;
    if (!world || !world.width || !world.height) return DEFAULT_PAD;
    var relSize = Math.max(bbox.width / world.width, bbox.height / world.height);
    if (relSize < 0.01) return 0.30;
    if (relSize < 0.05) return 0.22;
    if (relSize < 0.20) return 0.18;
    return 0.12;
  }

  /**
   * Núcleo del cálculo: dado un iso, decide qué paths usar y qué viewBox
   * aplicar. No renderiza — sólo devuelve datos.
   *
   * @param {SVGSVGElement} svg
   * @param {string} iso
   * @param {object} [opts]
   *   - pad {number}                 default DEFAULT_PAD
   *   - containerAspect {number}     default CONTAINER_ASPECT
   * @returns {{ ok:true, paths, bbox, viewBox } | { ok:false, reason:string }}
   */
  function focusCountry(svg, iso, opts) {
    if (!svg) return { ok:false, reason:'no-svg' };
    opts = opts || {};
    var containerAspect = opts.containerAspect || CONTAINER_ASPECT;

    var paths = _selectCountryPaths(svg, iso);
    if (!paths.length) return { ok:false, reason:'not-found' };

    var boxes = paths.map(_measure);
    var union = _unionBBox(boxes);
    if (!union) return { ok:false, reason:'empty-bbox' };

    // Si la unión abarca una porción excesiva del mundo o está demasiado
    // dispersa por territorios lejanos (US, CA, FR, PT, NL...), quedarnos con
    // el mainland: priorizamos el path exacto "XX" si es comparable al mayor
    // sub-path y, si no, usamos el de mayor área. En países
    // como RU, cuyo mainland es un único path muy ancho y bajo, este recorte no
    // cambia la bbox y el encuadre final se resuelve en _computeFramedViewBox()
    // por la rama de aspect ratio extremo.
    var world = _rootViewBox(svg);
    var mainlandIdx = _pickMainlandIndex(paths, boxes, String(iso).toUpperCase());
    if (world) {
      var wFrac = union.width  / world.width;
      var hFrac = union.height / world.height;
      var mainlandBox = mainlandIdx >= 0 ? boxes[mainlandIdx] : null;
      var isDispersed = mainlandBox && paths.length > 1 && (
        union.width  > mainlandBox.width  * 2.5 ||
        union.height > mainlandBox.height * 2.5
      );
      if (wFrac > MAX_FRACTION_OF_WORLD || hFrac > MAX_FRACTION_OF_WORLD || isDispersed) {
        if (mainlandIdx >= 0) {
          paths = [ paths[mainlandIdx] ];
          union = boxes[mainlandIdx];
        }
      }
    }

    var pad = _resolvePad(union, world, opts.pad);
    var viewBox = _computeFramedViewBox(union, containerAspect, pad);
    return { ok:true, paths: paths, bbox: union, viewBox: viewBox };
  }

  /**
   * Construye un <svg> standalone con SOLO la silueta del país objetivo,
   * listo para insertar en el DOM. No revela pistas de países vecinos.
   *
   * @param {string} iso alpha-2
   * @param {object} [opts]
   *   - pad, containerAspect       (como focusCountry)
   *   - fill {string}              color de relleno (default currentColor)
   *   - ariaLabel {string}         para accesibilidad
   * @returns {SVGSVGElement | null}
   */
  function buildCountrySvg(iso, opts) {
    if (!_worldSvg) return null;
    opts = opts || {};
    var focus = focusCountry(_worldSvg, iso, opts);
    if (!focus.ok) return null;

    var out = document.createElementNS(SVG_NS, 'svg');
    out.setAttribute('xmlns', SVG_NS);
    out.setAttribute('viewBox',
      focus.viewBox.x + ' ' + focus.viewBox.y + ' ' +
      focus.viewBox.width + ' ' + focus.viewBox.height);
    out.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    out.setAttribute('role', 'img');
    if (opts.ariaLabel) out.setAttribute('aria-label', opts.ariaLabel);

    var g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('fill', opts.fill || 'currentColor');
    g.setAttribute('stroke', 'none');
    for (var i = 0; i < focus.paths.length; i++) {
      var src = focus.paths[i];
      var d   = src.getAttribute('d');
      if (!d) continue;
      var p   = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      var fr = src.getAttribute('fill-rule');
      if (fr) p.setAttribute('fill-rule', fr);
      g.appendChild(p);
    }
    out.appendChild(g);
    return out;
  }

  global.Silhouette = {
    preload:            preload,
    hasSilhouetteFor:   hasSilhouetteFor,
    getAvailableCodes:  getAvailableCodes,
    buildCountrySvg:    buildCountrySvg,
    focusCountry:       focusCountry,
  };
})(typeof window !== 'undefined' ? window : this);
