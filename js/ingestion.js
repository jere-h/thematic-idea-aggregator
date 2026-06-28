/*
 * TrendDeck — js/ingestion.js
 * ---------------------------------------------------------------------------
 * Signal ingestion view. Responsibilities:
 *   - The "New Round" action (start a fresh empty round, or reload the bundled
 *     sample round).
 *   - The add-signal form: theme label, source URL, optional thumbnail URL.
 *   - In-browser CSV import via FileReader + PapaParse.
 *   - Validates / normalizes rows, persists them through store.js, and lists
 *     saved signals back so everything survives a page reload.
 *
 * This module is intentionally defensive about the exact store.js method names
 * (all sibling files are generated together): it probes for a handful of
 * plausible method names and falls back gracefully. The persisted shape it
 * relies on is a single "round" object that owns a `signals` array.
 *
 * Exposed globally as `window.Ingestion` with `render(container)` so the SPA
 * router in index.html can mount this view.
 */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------------- *
   * Store adapter
   * ---------------------------------------------------------------------- *
   * store.js is the single source of truth for persistence. Because we cannot
   * import it directly in a no-build static app, we look it up on `window` and
   * probe for the methods we need, with sensible fallbacks. If the store is
   * missing entirely (should not happen in normal operation) we degrade to a
   * local-only in-memory round so the form still works for the current page.
   */
  function store() {
    return global.Store || global.TrendStore || global.trendStore || null;
  }

  function call(obj, names, args) {
    if (!obj) return undefined;
    for (var i = 0; i < names.length; i++) {
      var fn = obj[names[i]];
      if (typeof fn === 'function') {
        return fn.apply(obj, args || []);
      }
    }
    return undefined;
  }

  // Last-resort local fallback so the UI never hard-crashes if store.js is
  // unavailable. Not used in the normal path.
  var FALLBACK_KEY = 'trenddeck:ingestion-fallback-round';
  function fallbackGetRound() {
    try {
      var raw = global.localStorage.getItem(FALLBACK_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    var round = { id: 'local-' + nowStamp(), name: 'Untitled Round', signals: [], cards: [], votes: [], settings: {} };
    fallbackSaveRound(round);
    return round;
  }
  function fallbackSaveRound(round) {
    try { global.localStorage.setItem(FALLBACK_KEY, JSON.stringify(round)); } catch (e) { /* ignore */ }
    return round;
  }

  function getRound() {
    var s = store();
    // Prefer the no-arg "active round" accessors. store.js's getRound(roundId)
    // requires an id and returns null when called with none, so it must NOT be
    // probed before getActiveRound or the seeded sample round is never read.
    var round = call(s, ['getActiveRound', 'getCurrentRound', 'currentRound', 'loadRound']);
    if (round && typeof round === 'object') return round;
    return fallbackGetRound();
  }

  function saveRound(round) {
    var s = store();
    // store.js has no whole-round "save" (its mutators are field-scoped and
    // commit internally); these names are only here for an alternate store
    // implementation. When none match, fall back to local persistence.
    var saved = call(s, ['saveRound', 'putRound', 'setRound', 'persistRound', 'save'], [round]);
    if (saved === undefined) {
      fallbackSaveRound(round);
    }
    return round;
  }

  function newRound(name) {
    var s = store();
    var created = call(s, ['newRound', 'createRound', 'resetRound', 'startRound'], [name]);
    if (created && typeof created === 'object') return created;
    // Fallback: build an empty round and persist it.
    var round = {
      id: 'round-' + nowStamp(),
      name: name || 'Untitled Round',
      signals: [],
      cards: [],
      votes: [],
      settings: { roundClosed: false, deptSuppressionThreshold: 3 }
    };
    saveRound(round);
    return round;
  }

  function reseedSample() {
    var s = store();
    // Prefer an explicit re-seed/clear path on the store.
    var result = call(s, ['seedSampleRound', 'loadSampleRound', 'reseedSample', 'resetToSample', 'seedSample']);
    if (result !== undefined) return result;
    // Fallback: if a global sample dataset is exposed, install it directly.
    var sample = global.SAMPLE_ROUND || global.SampleData || global.sampleRound || null;
    if (sample && typeof sample === 'object') {
      var round = JSON.parse(JSON.stringify(sample.round || sample));
      saveRound(round);
      return round;
    }
    return null;
  }

  /* ---------------------------------------------------------------------- *
   * Helpers
   * ---------------------------------------------------------------------- */
  var idCounter = 0;
  function nowStamp() {
    return Date.now().toString(36) + '-' + (idCounter++).toString(36);
  }
  function genId() {
    return 'sig-' + nowStamp() + '-' + Math.floor(Math.random() * 1e6).toString(36);
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function trim(v) {
    return (v === null || v === undefined) ? '' : String(v).trim();
  }

  // Normalize / validate a URL. Returns '' when clearly not a usable URL.
  function normalizeUrl(raw) {
    var v = trim(raw);
    if (!v) return '';
    // Allow protocol-less entries by assuming https.
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) {
      if (/^[\w-]+(\.[\w-]+)+/.test(v)) {
        v = 'https://' + v;
      }
    }
    try {
      var u = new URL(v);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        return u.href;
      }
    } catch (e) { /* fall through */ }
    return '';
  }

  // Derive a friendly source platform from a URL host.
  function platformFromUrl(url) {
    var v = trim(url);
    if (!v) return 'Other';
    var host = '';
    try {
      host = new URL(v).hostname.toLowerCase();
    } catch (e) {
      return 'Other';
    }
    host = host.replace(/^www\./, '');
    var map = [
      ['instagram.com', 'Instagram'],
      ['tiktok.com', 'TikTok'],
      ['pinterest.', 'Pinterest'],
      ['behance.net', 'Behance'],
      ['dribbble.com', 'Dribbble'],
      ['youtube.com', 'YouTube'],
      ['youtu.be', 'YouTube'],
      ['twitter.com', 'X / Twitter'],
      ['x.com', 'X / Twitter'],
      ['threads.net', 'Threads'],
      ['vimeo.com', 'Vimeo'],
      ['are.na', 'Are.na'],
      ['arena.com', 'Are.na'],
      ['medium.com', 'Medium'],
      ['substack.com', 'Substack'],
      ['reddit.com', 'Reddit'],
      ['wgsn.com', 'WGSN'],
      ['notjustalabel', 'NJAL'],
      ['cosmos.so', 'Cosmos'],
      ['savee.it', 'Savee']
    ];
    for (var i = 0; i < map.length; i++) {
      if (host.indexOf(map[i][0]) !== -1) return map[i][1];
    }
    // Fall back to the registrable-ish domain, title-cased.
    var parts = host.split('.');
    var base = parts.length >= 2 ? parts[parts.length - 2] : host;
    if (!base) return 'Other';
    return base.charAt(0).toUpperCase() + base.slice(1);
  }

  // Build a normalized signal from loose input. Returns null when invalid
  // (a theme label is the only hard requirement; a usable source URL is
  // strongly preferred but not strictly required).
  function makeSignal(input) {
    var theme = trim(input.theme || input.label || input.title || input.name);
    if (!theme) return null;
    var source = normalizeUrl(input.source || input.url || input.link || input.href);
    var thumb = normalizeUrl(input.thumbnail || input.thumb || input.image || input.img);
    return {
      id: input.id ? String(input.id) : genId(),
      theme: theme,
      sourceUrl: source,
      source: source,
      thumbnailUrl: thumb,
      thumbnail: thumb,
      platform: platformFromUrl(source),
      createdAt: new Date().toISOString()
    };
  }

  /* ---------------------------------------------------------------------- *
   * Persistence of signals (always through the round object)
   * ---------------------------------------------------------------------- */
  function readSignals() {
    var round = getRound();
    if (!round) return [];
    if (!Array.isArray(round.signals)) round.signals = [];
    return round.signals;
  }

  function writeSignals(signals) {
    var s = store();
    // For store.js (roundId-first, field-scoped mutators) there is no whole-round
    // setter, so reconcile the current signal set against the desired one by
    // removing/adding through the store's own API (keeps cards/votes consistent).
    if (isRoundIdFirstStore(s)) {
      var keep = {};
      (signals || []).forEach(function (sig) { if (sig && sig.id) keep[sig.id] = true; });
      var current = readSignals().slice();
      var have = {};
      current.forEach(function (sig) {
        have[sig.id] = true;
        if (!keep[sig.id] && typeof s.removeSignal === 'function') s.removeSignal(null, sig.id);
      });
      var toAdd = (signals || []).filter(function (sig) { return !sig.id || !have[sig.id]; });
      if (toAdd.length) addSignals(toAdd);
      return;
    }
    var round = getRound();
    if (!round) return;
    round.signals = signals;
    saveRound(round);
  }

  // store.js uses roundId-first signatures (addSignals(roundId, signals),
  // addSignal(roundId, signal), removeSignal(roundId, signalId)) and operates on
  // the active round when the id is falsy. Detect that store via getActiveRoundId
  // so we pass the id slot explicitly instead of putting the payload there.
  function isRoundIdFirstStore(s) {
    return !!(s && typeof s.getActiveRoundId === 'function');
  }

  function addSignals(newOnes) {
    if (!newOnes || !newOnes.length) return 0;
    var s = store();
    if (isRoundIdFirstStore(s)) {
      if (typeof s.addSignals === 'function') { s.addSignals(null, newOnes); return newOnes.length; }
      if (typeof s.addSignal === 'function') {
        for (var k = 0; k < newOnes.length; k++) s.addSignal(null, newOnes[k]);
        return newOnes.length;
      }
    }
    // Alternate store APIs (payload-first) / probing fallbacks.
    var bulk = call(s, ['addSignals', 'importSignals', 'appendSignals'], [newOnes]);
    if (bulk !== undefined) return newOnes.length;
    if (s && typeof s.addSignal === 'function') {
      for (var i = 0; i < newOnes.length; i++) s.addSignal(newOnes[i]);
      return newOnes.length;
    }
    // Fallback: merge into the round ourselves.
    var existing = readSignals().slice();
    for (var j = 0; j < newOnes.length; j++) existing.push(newOnes[j]);
    writeSignals(existing);
    return newOnes.length;
  }

  function removeSignal(id) {
    var s = store();
    if (isRoundIdFirstStore(s) && typeof s.removeSignal === 'function') {
      s.removeSignal(null, id);
      return;
    }
    var removed = call(s, ['removeSignal', 'deleteSignal'], [id]);
    if (removed !== undefined) return;
    var existing = readSignals().filter(function (sig) { return sig.id !== id; });
    writeSignals(existing);
  }

  /* ---------------------------------------------------------------------- *
   * Rendering
   * ---------------------------------------------------------------------- */
  var mountEl = null;
  var flash = { msg: '', kind: '' };

  function setFlash(msg, kind) {
    flash = { msg: msg || '', kind: kind || 'info' };
  }

  function isSampleRound() {
    var round = getRound();
    if (!round) return false;
    if (round.isSample === true || round.sample === true) return true;
    var id = trim(round.id).toLowerCase();
    return id.indexOf('sample') !== -1;
  }

  function render(container) {
    mountEl = container || mountEl ||
      document.getElementById('ingestion-root') ||
      document.getElementById('view') || document.getElementById('app');
    if (!mountEl) return;
    var round = getRound();
    var signals = readSignals();
    var roundName = round ? (round.name || 'Untitled Round') : 'Untitled Round';

    var html = '' +
      '<section class="view view-signals" id="signals-view">' +
        '<header class="view-header">' +
          '<div class="view-header-main">' +
            // The static #view-round head in index.html already renders the
            // "Signals" title + lede; we only emit the round-meta/count sub-line
            // here so the page shows a single heading.
            '<p class="view-sub">Round: <strong>' + escapeHtml(roundName) + '</strong> · ' +
              '<span class="count-pill">' + signals.length + ' signal' + (signals.length === 1 ? '' : 's') + '</span>' +
              (isSampleRound() ? ' <span class="badge badge-sample">Example data</span>' : '') +
            '</p>' +
          '</div>' +
          '<div class="view-header-actions">' +
            '<button type="button" class="btn btn--secondary" id="btn-new-round">＋ New Round</button>' +
            '<button type="button" class="btn btn--ghost" id="btn-load-sample">Reload sample</button>' +
          '</div>' +
        '</header>' +

        (flash.msg ? '<div class="flash flash-' + escapeHtml(flash.kind) + '" role="status">' + escapeHtml(flash.msg) + '</div>' : '') +

        '<div class="ingest-grid">' +
          // --- Add single signal ---
          '<div class="panel panel-add-signal">' +
            '<h2>Add a signal</h2>' +
            '<form id="add-signal-form" class="stack-form" autocomplete="off">' +
              '<label class="field">' +
                '<span class="field-label">Theme label <abbr title="required">*</abbr></span>' +
                '<input type="text" name="theme" id="f-theme" placeholder="e.g. Acid-washed utility denim" required maxlength="120" />' +
              '</label>' +
              '<label class="field">' +
                '<span class="field-label">Source URL</span>' +
                '<input type="url" name="source" id="f-source" placeholder="https://instagram.com/p/..." />' +
              '</label>' +
              '<label class="field">' +
                '<span class="field-label">Thumbnail URL <em>(optional)</em></span>' +
                '<input type="url" name="thumbnail" id="f-thumb" placeholder="https://.../image.jpg" />' +
              '</label>' +
              '<div class="form-actions">' +
                '<button type="submit" class="btn btn--primary">Add signal</button>' +
              '</div>' +
            '</form>' +
          '</div>' +

          // --- CSV import ---
          '<div class="panel panel-import">' +
            '<h2>Import CSV</h2>' +
            '<p class="panel-hint">Columns are matched loosely. Recognized headers: ' +
              '<code>theme</code> / <code>label</code>, <code>source</code> / <code>url</code>, ' +
              '<code>thumbnail</code> / <code>image</code>.</p>' +
            '<label class="file-drop" id="csv-drop">' +
              '<input type="file" id="csv-input" accept=".csv,text/csv" hidden />' +
              '<span class="file-drop-inner">' +
                '<strong>Choose a CSV file</strong> or drag &amp; drop here' +
              '</span>' +
            '</label>' +
            '<div class="import-tools">' +
              '<button type="button" class="btn btn--ghost btn--sm" id="btn-sample-csv">Download CSV template</button>' +
            '</div>' +
            '<div id="csv-report" class="import-report" aria-live="polite"></div>' +
          '</div>' +
        '</div>' +

        // --- Saved signals list ---
        '<div class="panel panel-signal-list">' +
          '<div class="panel-list-head">' +
            '<h2>Saved signals</h2>' +
            (signals.length ? '<button type="button" class="btn btn--danger btn--sm" id="btn-clear-signals">Clear all</button>' : '') +
          '</div>' +
          renderSignalList(signals) +
        '</div>' +
      '</section>';

    mountEl.innerHTML = html;
    flash = { msg: '', kind: '' }; // consume one-shot flash
    wireEvents();
  }

  function renderSignalList(signals) {
    if (!signals || !signals.length) {
      return '<p class="empty-state">No signals yet. Add one above or import a CSV to get started.</p>';
    }
    var rows = signals.map(function (sig) {
      var source = sigSource(sig);
      var link = source
        ? '<a class="sig-source" href="' + escapeHtml(source) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(shortUrl(source)) + '</a>'
        : '<span class="sig-source sig-source-empty">no source link</span>';
      return '' +
        '<li class="sig-row" data-id="' + escapeHtml(sig.id) + '">' +
          thumbHtml(sig) +
          '<div class="sig-meta">' +
            '<span class="sig-theme">' + escapeHtml(sigTheme(sig)) + '</span>' +
            '<span class="sig-sub">' +
              '<span class="sig-platform">' + escapeHtml(sigPlatform(sig)) + '</span>' +
              ' · ' + link +
            '</span>' +
          '</div>' +
          '<button type="button" class="btn-remove" data-remove="' + escapeHtml(sig.id) + '" title="Remove signal" aria-label="Remove signal">✕</button>' +
        '</li>';
    }).join('');
    return '<ul class="signal-list">' + rows + '</ul>';
  }

  /* ---------------------------------------------------------------------- *
   * Self-contained thumbnails
   * ---------------------------------------------------------------------- *
   * A trend-voting tool is inherently visual, but external thumbnail URLs
   * break offline and on GitHub Pages. We generate a deterministic inline-SVG
   * placeholder from the signal text (theme initials + a hue derived from the
   * text) so every signal always has a self-contained visual. A real external
   * thumbnail, when present, is shown as an <img> that falls back to this SVG
   * on error.
   */

  // Stable 32-bit hash of a string (so the same theme always yields the same hue).
  function hashStr(str) {
    var h = 5381;
    str = String(str || '');
    for (var i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }

  function initials(text) {
    // Derive 1–2 initials from word-initial LETTERS/digits only, so leading
    // quotes/punctuation (e.g. Chunky "claymorphism") never leak into the badge.
    var words = String(text || '')
      .split(/\s+/)
      .map(function (w) { return w.replace(/^[^0-9a-z]+/i, ''); })
      .filter(Boolean);
    if (!words.length) return '?';
    if (words.length === 1) {
      var alnum = words[0].replace(/[^0-9a-z]/gi, '');
      return (alnum.slice(0, 2) || '?').toUpperCase();
    }
    return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
  }

  // Build a data-URI SVG: a two-stop diagonal gradient (hue from the text) with
  // the theme initials centered. Self-contained — no network needed.
  function placeholderSvg(text) {
    var h = hashStr(text);
    var hue = h % 360;
    var hue2 = (hue + 40) % 360;
    var label = escapeHtml(initials(text));
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200" role="img" aria-label="' + label + '">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0" stop-color="hsl(' + hue + ',62%,46%)"/>' +
          '<stop offset="1" stop-color="hsl(' + hue2 + ',58%,32%)"/>' +
        '</linearGradient></defs>' +
        '<rect width="320" height="200" fill="url(#g)"/>' +
        '<text x="160" y="112" text-anchor="middle" font-family="' +
          '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif" ' +
          'font-size="72" font-weight="700" fill="rgba(255,255,255,0.92)">' + label + '</text>' +
      '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  // <img> markup for a signal thumbnail. Always self-contained: uses the inline
  // SVG placeholder by default, and only an external URL when present — falling
  // back to the SVG via onerror so Pages/offline never shows a broken image.
  function thumbHtml(sig) {
    var theme = sigTheme(sig);
    var svg = placeholderSvg(theme);
    var ext = sigThumb(sig);
    var src = ext || svg;
    var onerror = ext
      ? ' onerror="this.onerror=null;this.src=\'' + escapeHtml(svg) + '\'"'
      : '';
    return '<img class="sig-thumb" src="' + escapeHtml(src) + '" alt="" loading="lazy"' + onerror + ' />';
  }

  /* ---------------------------------------------------------------------- *
   * Field accessors (store.js normalizes signals to theme/sourceUrl/
   * thumbnailUrl/platform; older/in-form shapes may use source/thumbnail).
   * ---------------------------------------------------------------------- */
  function sigTheme(sig) {
    return trim(sig && (sig.theme || sig.label || sig.title || sig.name));
  }
  function sigSource(sig) {
    return trim(sig && (sig.sourceUrl || sig.source || sig.url || sig.link || sig.href));
  }
  function sigThumb(sig) {
    return trim(sig && (sig.thumbnailUrl || sig.thumbnail || sig.image || sig.img));
  }
  function sigPlatform(sig) {
    return trim(sig && sig.platform) || platformFromUrl(sigSource(sig)) || 'Other';
  }

  function shortUrl(url) {
    var v = trim(url);
    try {
      var u = new URL(v);
      var path = u.pathname.length > 24 ? u.pathname.slice(0, 21) + '…' : u.pathname;
      return u.hostname.replace(/^www\./, '') + (path === '/' ? '' : path);
    } catch (e) {
      return v.length > 40 ? v.slice(0, 37) + '…' : v;
    }
  }

  /* ---------------------------------------------------------------------- *
   * Event wiring
   * ---------------------------------------------------------------------- */
  function wireEvents() {
    if (!mountEl) return;

    var addForm = mountEl.querySelector('#add-signal-form');
    if (addForm) {
      addForm.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var signal = makeSignal({
          theme: addForm.querySelector('#f-theme').value,
          source: addForm.querySelector('#f-source').value,
          thumbnail: addForm.querySelector('#f-thumb').value
        });
        if (!signal) {
          setFlash('A theme label is required.', 'error');
          render();
          return;
        }
        addSignals([signal]);
        setFlash('Added “' + signal.theme + '”.', 'success');
        render();
      });
    }

    var newRoundBtn = mountEl.querySelector('#btn-new-round');
    if (newRoundBtn) {
      newRoundBtn.addEventListener('click', function () {
        var name = global.prompt('Name this round:', 'Studio Trend Vote — ' + monthLabel());
        if (name === null) return; // cancelled
        name = trim(name) || 'Untitled Round';
        var ok = global.confirm('Start a NEW empty round called “' + name + '”?\n\n' +
          'This replaces the current round (signals, cards, and votes). ' +
          'Export the current round first if you want to keep it.');
        if (!ok) return;
        newRound(name);
        setFlash('Started a fresh round: “' + name + '”.', 'success');
        render();
      });
    }

    var sampleBtn = mountEl.querySelector('#btn-load-sample');
    if (sampleBtn) {
      sampleBtn.addEventListener('click', function () {
        var ok = global.confirm('Reload the bundled sample round?\n\n' +
          'This replaces the current round with the example signals, cards, and votes.');
        if (!ok) return;
        var seeded = reseedSample();
        if (seeded) {
          setFlash('Loaded the sample round.', 'success');
        } else {
          setFlash('Sample data is unavailable.', 'error');
        }
        render();
      });
    }

    var clearBtn = mountEl.querySelector('#btn-clear-signals');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        var ok = global.confirm('Remove ALL signals from this round? Cards and votes are left intact.');
        if (!ok) return;
        writeSignals([]);
        setFlash('Cleared all signals.', 'info');
        render();
      });
    }

    // Remove buttons (delegated).
    var list = mountEl.querySelector('.signal-list');
    if (list) {
      list.addEventListener('click', function (ev) {
        var btn = ev.target.closest('[data-remove]');
        if (!btn) return;
        removeSignal(btn.getAttribute('data-remove'));
        render();
      });
    }

    wireCsv();

    var tmplBtn = mountEl.querySelector('#btn-sample-csv');
    if (tmplBtn) {
      tmplBtn.addEventListener('click', downloadTemplate);
    }
  }

  function monthLabel() {
    try {
      return new Date().toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    } catch (e) {
      return '';
    }
  }

  /* ---------------------------------------------------------------------- *
   * CSV import (FileReader + PapaParse)
   * ---------------------------------------------------------------------- */
  function wireCsv() {
    var input = mountEl.querySelector('#csv-input');
    var drop = mountEl.querySelector('#csv-drop');
    if (!input || !drop) return;

    input.addEventListener('change', function () {
      if (input.files && input.files[0]) {
        handleCsvFile(input.files[0]);
        input.value = '';
      }
    });

    ['dragenter', 'dragover'].forEach(function (evt) {
      drop.addEventListener(evt, function (e) {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.add('is-dragover');
      });
    });
    ['dragleave', 'dragend', 'drop'].forEach(function (evt) {
      drop.addEventListener(evt, function (e) {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.remove('is-dragover');
      });
    });
    drop.addEventListener('drop', function (e) {
      var dt = e.dataTransfer;
      if (dt && dt.files && dt.files[0]) {
        handleCsvFile(dt.files[0]);
      }
    });
  }

  function reportEl() {
    return mountEl ? mountEl.querySelector('#csv-report') : null;
  }

  function setReport(html, kind) {
    var el = reportEl();
    if (!el) return;
    el.className = 'import-report' + (kind ? ' import-report-' + kind : '');
    el.innerHTML = html;
  }

  function handleCsvFile(file) {
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
      setReport('That doesn’t look like a CSV file.', 'error');
      return;
    }
    setReport('Reading <strong>' + escapeHtml(file.name) + '</strong>…', 'info');

    var reader = new FileReader();
    reader.onerror = function () {
      setReport('Could not read the file.', 'error');
    };
    reader.onload = function (e) {
      var text = e.target && e.target.result ? String(e.target.result) : '';
      parseCsvText(text, file.name);
    };
    reader.readAsText(file);
  }

  function parseCsvText(text, fileName) {
    if (!global.Papa || typeof global.Papa.parse !== 'function') {
      setReport('CSV parser (PapaParse) is not loaded.', 'error');
      return;
    }
    var parsed;
    try {
      parsed = global.Papa.parse(text, {
        header: true,
        skipEmptyLines: 'greedy',
        transformHeader: function (h) { return normalizeHeader(h); }
      });
    } catch (err) {
      setReport('Failed to parse CSV: ' + escapeHtml(err && err.message ? err.message : String(err)), 'error');
      return;
    }

    var rows = (parsed && parsed.data) || [];
    var headerless = false;

    // If header parsing didn't yield a usable theme column, retry without
    // headers and treat columns positionally (theme, source, thumbnail).
    var hasThemeCol = rows.length && rows.some(function (r) {
      return r && (r.theme || r.label || r.title || r.name);
    });
    if (!hasThemeCol) {
      headerless = true;
      var raw = global.Papa.parse(text, { header: false, skipEmptyLines: 'greedy' });
      rows = ((raw && raw.data) || []).map(function (cols) {
        return { theme: cols[0], source: cols[1], thumbnail: cols[2] };
      });
      // Drop a likely header row if the first cell looks like a label name.
      if (rows.length && /^(theme|label|title|name|signal)$/i.test(trim(rows[0].theme))) {
        rows = rows.slice(1);
      }
    }

    var accepted = [];
    var skipped = 0;
    var seen = Object.create(null);
    var existing = readSignals();
    existing.forEach(function (s) { seen[dedupeKey(s.theme, s.source)] = true; });

    for (var i = 0; i < rows.length; i++) {
      var signal = makeSignal(rows[i]);
      if (!signal) { skipped++; continue; }
      var key = dedupeKey(signal.theme, signal.source);
      if (seen[key]) { skipped++; continue; }
      seen[key] = true;
      accepted.push(signal);
    }

    if (!accepted.length) {
      setReport('No new signals found in <strong>' + escapeHtml(fileName) + '</strong>' +
        (skipped ? ' (' + skipped + ' row' + (skipped === 1 ? '' : 's') + ' skipped — missing label or duplicate).' : '.'),
        'error');
      return;
    }

    addSignals(accepted);
    var parseWarn = (parsed && parsed.errors && parsed.errors.length)
      ? ' <span class="report-warn">(' + parsed.errors.length + ' parser warning' + (parsed.errors.length === 1 ? '' : 's') + ')</span>'
      : '';
    setFlash('Imported ' + accepted.length + ' signal' + (accepted.length === 1 ? '' : 's') +
      ' from ' + fileName + (skipped ? ' (' + skipped + ' skipped)' : '') +
      (headerless ? ' — read positionally (no recognized header).' : '.') + parseWarn, 'success');
    render();
  }

  function normalizeHeader(h) {
    var key = trim(h).toLowerCase().replace(/[\s_-]+/g, '');
    var map = {
      theme: 'theme', themelabel: 'theme', label: 'theme', title: 'theme', name: 'theme', signal: 'theme', trend: 'theme',
      source: 'source', sourceurl: 'source', url: 'source', link: 'source', href: 'source', permalink: 'source',
      thumbnail: 'thumbnail', thumbnailurl: 'thumbnail', thumb: 'thumbnail', image: 'thumbnail', imageurl: 'thumbnail', img: 'thumbnail', preview: 'thumbnail'
    };
    return map[key] || key;
  }

  function dedupeKey(theme, source) {
    return trim(theme).toLowerCase() + '||' + trim(source).toLowerCase();
  }

  /* ---------------------------------------------------------------------- *
   * CSV template download
   * ---------------------------------------------------------------------- */
  function downloadTemplate() {
    var csv = [
      'theme,source,thumbnail',
      '"Acid-washed utility denim",https://instagram.com/p/example1,https://example.com/denim.jpg',
      '"Chrome liquid-metal accessories",https://pinterest.com/pin/example2,',
      '"Soft-tech quiet outerwear",https://tiktok.com/@studio/video/example3,'
    ].join('\n');
    try {
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'trenddeck-signals-template.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (e) {
      setReport('Could not generate the template in this browser.', 'error');
    }
  }

  /* ---------------------------------------------------------------------- *
   * Router integration
   * ---------------------------------------------------------------------- *
   * index.html's hash router dispatches `trenddeck:render` with
   * detail.route when a view becomes active. The Signals view lives in
   * `#ingestion-root`; mount into it whenever the round/signals route is shown
   * (and once on DOMContentLoaded so the first paint is populated).
   */
  function isSignalsRoute(route) {
    var r = String(route || '').toLowerCase();
    return r === 'round' || r === 'signals' || r === '' ;
  }

  function mountSignals() {
    var root = document.getElementById('ingestion-root');
    if (root) render(root);
  }

  document.addEventListener('trenddeck:render', function (ev) {
    var detail = ev && ev.detail ? ev.detail : {};
    if (isSignalsRoute(detail.route)) mountSignals();
  });

  function ingestionBoot() {
    // Only paint if the signals view is the active route on first load.
    var hash = (global.location && global.location.hash || '').replace(/^#\/?/, '').toLowerCase();
    if (isSignalsRoute(hash)) mountSignals();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ingestionBoot);
  } else {
    ingestionBoot();
  }

  /* ---------------------------------------------------------------------- *
   * Public API
   * ---------------------------------------------------------------------- */
  global.Ingestion = {
    render: render,
    // Exposed for reuse/testing by sibling modules.
    makeSignal: makeSignal,
    normalizeUrl: normalizeUrl,
    platformFromUrl: platformFromUrl,
    readSignals: readSignals,
    addSignals: addSignals
  };
})(typeof window !== 'undefined' ? window : this);
