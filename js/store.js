/*
 * TrendDeck — js/store.js
 * ------------------------------------------------------------------
 * Client-side persistence layer over localStorage implementing the
 * studio -> round -> signal -> trend_card -> vote data model.
 *
 * Responsibilities:
 *   - Round CRUD (create / read / update / delete / set-active).
 *   - Signal, card and vote sub-collection operations.
 *   - Admin-adjustable settings (dept-suppression threshold,
 *     round-closed flag).
 *   - Export / import of a round as JSON (for cross-device vote
 *     merging — votes are union-merged by id).
 *   - Share-link encode / decode (unicode-safe base64 in the URL hash).
 *   - Seeds the bundled sample round on first run when storage is empty.
 *   - A tiny pub/sub so the hash-routed views can re-render on change.
 *
 * Exposes a single global: window.Store
 * No external dependencies. Safe to load before sample-data.js as long
 * as Store.init() is called after the DOM/scripts are ready, but it also
 * lazily seeds on first access.
 * ------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'trenddeck.state.v1';
  var SESSION_KEY = 'trenddeck.session.v1';
  var SCHEMA_VERSION = 1;
  var DEFAULT_DEPT_THRESHOLD = 2;

  /* ----------------------------------------------------------------
   * Low-level helpers
   * ---------------------------------------------------------------- */

  function uid(prefix) {
    prefix = prefix || 'id';
    try {
      if (global.crypto && typeof global.crypto.randomUUID === 'function') {
        return prefix + '_' + global.crypto.randomUUID();
      }
    } catch (e) { /* ignore */ }
    var rand = '';
    try {
      if (global.crypto && global.crypto.getRandomValues) {
        var arr = new Uint32Array(2);
        global.crypto.getRandomValues(arr);
        rand = arr[0].toString(36) + arr[1].toString(36);
      }
    } catch (e) { /* ignore */ }
    if (!rand) {
      // Deterministic-ish fallback (Math.random allowed in browser runtime).
      rand = Math.floor(Math.random() * 1e9).toString(36) +
        Math.floor(Math.random() * 1e9).toString(36);
    }
    return prefix + '_' + rand;
  }

  function nowISO() {
    try { return new Date().toISOString(); } catch (e) { return ''; }
  }

  function clone(value) {
    if (value === null || value === undefined) return value;
    try { return JSON.parse(JSON.stringify(value)); }
    catch (e) { return value; }
  }

  function isObject(v) {
    return v && typeof v === 'object' && !Array.isArray(v);
  }

  function asArray(v) {
    return Array.isArray(v) ? v : [];
  }

  function clamp(n, lo, hi) {
    n = Number(n);
    if (isNaN(n)) n = lo;
    return Math.max(lo, Math.min(hi, n));
  }

  // Unicode-safe base64 (handles non-ASCII labels/rationales).
  function utf8ToB64(str) {
    try {
      return global.btoa(unescape(encodeURIComponent(str)));
    } catch (e) {
      // Older fallback path.
      return global.btoa(str);
    }
  }

  function b64ToUtf8(b64) {
    try {
      return decodeURIComponent(escape(global.atob(b64)));
    } catch (e) {
      return global.atob(b64);
    }
  }

  function toUrlSafe(b64) {
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromUrlSafe(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return s;
  }

  /* ----------------------------------------------------------------
   * Pub/sub
   * ---------------------------------------------------------------- */

  var listeners = [];

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    return function unsubscribe() {
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function emit(event) {
    event = event || { type: 'change' };
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](event); } catch (e) { /* listener errors are non-fatal */ }
    }
  }

  /* ----------------------------------------------------------------
   * Persistence
   * ---------------------------------------------------------------- */

  // In-memory mirror used both as a cache and as a fallback if
  // localStorage is unavailable (private mode, quota, etc.).
  var memoryState = null;
  var storageWorks = true;

  function readRaw() {
    if (!storageWorks) return memoryState ? clone(memoryState) : null;
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      storageWorks = false;
      return memoryState ? clone(memoryState) : null;
    }
  }

  function writeRaw(state) {
    memoryState = clone(state);
    if (!storageWorks) return;
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      storageWorks = false; // fall back to memory only
    }
  }

  function emptyState() {
    return {
      version: SCHEMA_VERSION,
      activeRoundId: null,
      rounds: {},
      seededSample: false
    };
  }

  function normalizeState(state) {
    if (!isObject(state)) return emptyState();
    if (!isObject(state.rounds)) state.rounds = {};
    if (typeof state.version !== 'number') state.version = SCHEMA_VERSION;
    if (!('seededSample' in state)) state.seededSample = false;
    // Normalize each round.
    var ids = Object.keys(state.rounds);
    for (var i = 0; i < ids.length; i++) {
      state.rounds[ids[i]] = normalizeRound(state.rounds[ids[i]]);
    }
    // Ensure activeRoundId points at something real.
    if (!state.activeRoundId || !state.rounds[state.activeRoundId]) {
      state.activeRoundId = ids.length ? ids[0] : null;
    }
    return state;
  }

  function normalizeRound(round) {
    if (!isObject(round)) round = {};
    round.id = round.id || uid('round');
    round.name = typeof round.name === 'string' && round.name.trim()
      ? round.name : 'Untitled Round';
    round.createdAt = round.createdAt || nowISO();
    round.updatedAt = round.updatedAt || round.createdAt;
    round.isSample = !!round.isSample;
    round.closed = !!round.closed;
    if (!isObject(round.settings)) round.settings = {};
    round.settings.deptSuppressionThreshold = clamp(
      round.settings.deptSuppressionThreshold == null
        ? DEFAULT_DEPT_THRESHOLD
        : round.settings.deptSuppressionThreshold,
      0, 999
    );
    round.signals = asArray(round.signals).map(normalizeSignal);
    round.cards = asArray(round.cards).map(normalizeCard);
    round.votes = asArray(round.votes).map(normalizeVote);
    return round;
  }

  // Derive a friendly platform label from a URL host. Dependency-free mirror
  // of ingestion.platformFromUrl's intent; returns '' (NOT 'Other') when there
  // is no usable host so the display layers decide on a fallback.
  function platformFromHost(url) {
    var v = String(url || '').trim();
    if (!v) return '';
    var host = '';
    try {
      host = new URL(v).hostname.toLowerCase().replace(/^www\./, '');
    } catch (e) {
      return '';
    }
    if (!host) return '';
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
    var parts = host.split('.');
    var base = parts.length >= 2 ? parts[parts.length - 2] : host;
    if (!base) return '';
    return base.charAt(0).toUpperCase() + base.slice(1);
  }

  function normalizeSignal(sig) {
    if (!isObject(sig)) sig = {};
    var sourceUrl = String(sig.sourceUrl || sig.url || sig.source || sig.link || sig.href || '').trim();
    var platform = String(sig.platform || '').trim();
    return {
      id: sig.id || uid('sig'),
      theme: String(sig.theme || sig.label || sig.title || '').trim(),
      sourceUrl: sourceUrl,
      thumbnailUrl: String(sig.thumbnailUrl || sig.thumbnail || sig.image || '').trim(),
      platform: platform || platformFromHost(sourceUrl),
      note: String(sig.note || '').trim(),
      createdAt: sig.createdAt || nowISO()
    };
  }

  function normalizeCard(card) {
    if (!isObject(card)) card = {};
    var sources = isObject(card.sources) ? card.sources : {};
    return {
      id: card.id || uid('card'),
      label: String(card.label || card.name || '').trim(),
      rationale: String(card.rationale || card.summary || '').trim(),
      signalIds: asArray(card.signalIds).map(String),
      sources: sources,
      score: typeof card.score === 'number' ? card.score : Number(card.score) || 0,
      thumbnailUrl: String(card.thumbnailUrl || card.thumbnail || card.image || '').trim(),
      createdAt: card.createdAt || nowISO()
    };
  }

  function normalizeVote(vote) {
    if (!isObject(vote)) vote = {};
    return {
      id: vote.id || uid('vote'),
      sessionId: String(vote.sessionId || '').trim(),
      department: String(vote.department || '').trim(),
      winnerCardId: String(vote.winnerCardId || vote.winner || '').trim(),
      loserCardId: String(vote.loserCardId || vote.loser || '').trim(),
      pairKey: String(vote.pairKey || pairKeyFor(vote.winnerCardId, vote.loserCardId)),
      createdAt: vote.createdAt || nowISO()
    };
  }

  function pairKeyFor(a, b) {
    a = String(a || '');
    b = String(b || '');
    return [a, b].sort().join('::');
  }

  /* ----------------------------------------------------------------
   * Sample seeding
   * ---------------------------------------------------------------- */

  // Resolve the sample round from whatever global sample-data.js exposes.
  function resolveSampleRound() {
    var candidates = [
      global.TRENDDECK_SAMPLE_ROUND,
      global.TRENDDECK_SAMPLE,
      global.SAMPLE_ROUND,
      global.SampleData,
      global.SAMPLE_DATA
    ];
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (!c) continue;
      if (typeof c === 'function') {
        try { c = c(); } catch (e) { c = null; }
      }
      if (isObject(c) && typeof c.getSampleRound === 'function') {
        try { c = c.getSampleRound(); } catch (e) { c = null; }
      }
      // Prefer a wrapper's named `.round` (the documented contract:
      // window.TRENDDECK_SAMPLE.round) over the wrapper itself, which carries
      // signals/cards/votes but no round name → an "Untitled Round" seed.
      if (isObject(c) && isObject(c.round) &&
          (c.round.signals || c.round.cards || c.round.votes)) {
        return clone(c.round);
      }
      if (isObject(c) && (c.signals || c.cards || c.votes)) {
        return clone(c);
      }
    }
    return null;
  }

  // Minimal inline fallback so the app is never an empty shell, even if
  // sample-data.js failed to load. The richer dataset lives in
  // js/sample-data.js and takes precedence when present.
  function fallbackSampleRound() {
    var sig = [
      { theme: 'Chunky retro-future UI in product demos', platform: 'Dribbble',
        sourceUrl: 'https://dribbble.com', thumbnailUrl: '' },
      { theme: 'Hand-drawn annotation overlays on photos', platform: 'Instagram',
        sourceUrl: 'https://instagram.com', thumbnailUrl: '' },
      { theme: 'Muted earthy gradients replacing neon', platform: 'Behance',
        sourceUrl: 'https://behance.net', thumbnailUrl: '' },
      { theme: 'AI-assisted motion typography reels', platform: 'TikTok',
        sourceUrl: 'https://tiktok.com', thumbnailUrl: '' }
    ].map(normalizeSignal);

    var cards = [
      { label: 'Retro-Future Revival', rationale: 'Chunky, optimistic UI nostalgia is resurfacing across product and editorial work.',
        signalIds: [sig[0].id], sources: { Dribbble: 1 }, score: 72, thumbnailUrl: '' },
      { label: 'Annotated Realism', rationale: 'Hand-drawn marks over real photography signal authenticity and human touch.',
        signalIds: [sig[1].id], sources: { Instagram: 1 }, score: 64, thumbnailUrl: '' },
      { label: 'Earthy Restraint', rationale: 'A move away from neon toward grounded, muted palettes.',
        signalIds: [sig[2].id], sources: { Behance: 1 }, score: 58, thumbnailUrl: '' },
      { label: 'Generative Motion Type', rationale: 'AI tooling is making expressive kinetic typography cheap to produce.',
        signalIds: [sig[3].id], sources: { TikTok: 1 }, score: 69, thumbnailUrl: '' }
    ].map(normalizeCard);

    var depts = ['Design', 'Strategy', 'Engineering', 'Marketing'];
    var votes = [];
    for (var s = 0; s < 8; s++) {
      var session = uid('seed_sess');
      var dept = depts[s % depts.length];
      for (var p = 0; p < 4; p++) {
        var i = (s + p) % cards.length;
        var j = (s + p + 1) % cards.length;
        if (i === j) continue;
        // Bias winners toward higher-scored card for a realistic spread.
        var a = cards[i], b = cards[j];
        var winner = a.score >= b.score ? a : b;
        var loser = winner === a ? b : a;
        votes.push(normalizeVote({
          sessionId: session,
          department: dept,
          winnerCardId: winner.id,
          loserCardId: loser.id
        }));
      }
    }

    return {
      id: uid('round'),
      name: 'Sample: Q3 Visual Trend Pulse (example data)',
      isSample: true,
      closed: false,
      settings: { deptSuppressionThreshold: DEFAULT_DEPT_THRESHOLD },
      signals: sig,
      cards: cards,
      votes: votes
    };
  }

  function buildSampleRound() {
    var s = resolveSampleRound() || fallbackSampleRound();
    s = normalizeRound(s);
    s.isSample = true;
    if (!/example data|sample/i.test(s.name)) {
      s.name = s.name + ' (example data)';
    }
    return s;
  }

  /* ----------------------------------------------------------------
   * State access
   * ---------------------------------------------------------------- */

  function getState() {
    var state = readRaw();
    if (!state) {
      state = emptyState();
    }
    state = normalizeState(state);

    // First-run seeding: only when there are no rounds at all and we have
    // never seeded before.
    if (Object.keys(state.rounds).length === 0 && !state.seededSample) {
      var sample = buildSampleRound();
      state.rounds[sample.id] = sample;
      state.activeRoundId = sample.id;
      state.seededSample = true;
      writeRaw(state);
    }
    return state;
  }

  function commit(state, event) {
    state.version = SCHEMA_VERSION;
    writeRaw(state);
    emit(event || { type: 'change' });
    return state;
  }

  function withActiveRound(roundId) {
    var state = getState();
    var id = roundId || state.activeRoundId;
    var round = id ? state.rounds[id] : null;
    return { state: state, round: round, id: id };
  }

  function touch(round) {
    if (round) round.updatedAt = nowISO();
  }

  /* ----------------------------------------------------------------
   * Round CRUD
   * ---------------------------------------------------------------- */

  function listRounds() {
    var state = getState();
    return Object.keys(state.rounds).map(function (id) {
      return clone(state.rounds[id]);
    }).sort(function (a, b) {
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
  }

  function getActiveRound() {
    var ctx = withActiveRound();
    return ctx.round ? clone(ctx.round) : null;
  }

  function getActiveRoundId() {
    return getState().activeRoundId;
  }

  function getRound(roundId) {
    var state = getState();
    return state.rounds[roundId] ? clone(state.rounds[roundId]) : null;
  }

  function setActiveRound(roundId) {
    var state = getState();
    if (state.rounds[roundId]) {
      state.activeRoundId = roundId;
      commit(state, { type: 'active-changed', roundId: roundId });
    }
    return getActiveRound();
  }

  function createRound(name, opts) {
    opts = opts || {};
    var state = getState();
    var round = normalizeRound({
      name: name || 'New Trend Round',
      isSample: false,
      closed: false,
      settings: { deptSuppressionThreshold: DEFAULT_DEPT_THRESHOLD },
      signals: [],
      cards: [],
      votes: []
    });
    state.rounds[round.id] = round;
    if (opts.activate !== false) state.activeRoundId = round.id;
    commit(state, { type: 'round-created', roundId: round.id });
    return clone(round);
  }

  function updateRound(roundId, patch) {
    var ctx = withActiveRound(roundId);
    if (!ctx.round) return null;
    if (isObject(patch)) {
      if ('name' in patch) ctx.round.name = String(patch.name || ctx.round.name);
      if ('closed' in patch) ctx.round.closed = !!patch.closed;
      if (isObject(patch.settings)) {
        if ('deptSuppressionThreshold' in patch.settings) {
          ctx.round.settings.deptSuppressionThreshold =
            clamp(patch.settings.deptSuppressionThreshold, 0, 999);
        }
      }
    }
    touch(ctx.round);
    commit(ctx.state, { type: 'round-updated', roundId: ctx.id });
    return clone(ctx.round);
  }

  function renameRound(roundId, name) {
    return updateRound(roundId, { name: name });
  }

  function deleteRound(roundId) {
    var state = getState();
    if (!state.rounds[roundId]) return false;
    delete state.rounds[roundId];
    if (state.activeRoundId === roundId) {
      var ids = Object.keys(state.rounds);
      state.activeRoundId = ids.length ? ids[0] : null;
    }
    commit(state, { type: 'round-deleted', roundId: roundId });
    return true;
  }

  // Wipe everything and re-seed the sample round (the "reset to demo" path).
  function resetToSample() {
    var state = emptyState();
    var sample = buildSampleRound();
    state.rounds[sample.id] = sample;
    state.activeRoundId = sample.id;
    state.seededSample = true;
    commit(state, { type: 'reset', roundId: sample.id });
    return clone(sample);
  }

  // Hard clear (no re-seed). Next getState() will NOT re-seed because
  // seededSample stays true; use createRound to start fresh.
  function clearAll(opts) {
    opts = opts || {};
    var state = emptyState();
    state.seededSample = opts.allowReseed ? false : true;
    commit(state, { type: 'cleared' });
    return getState();
  }

  /* ----------------------------------------------------------------
   * Signals
   * ---------------------------------------------------------------- */

  function getSignals(roundId) {
    var ctx = withActiveRound(roundId);
    return ctx.round ? clone(ctx.round.signals) : [];
  }

  function addSignal(roundId, signal) {
    var ctx = withActiveRound(roundId);
    if (!ctx.round) return null;
    var s = normalizeSignal(signal);
    ctx.round.signals.push(s);
    touch(ctx.round);
    commit(ctx.state, { type: 'signal-added', roundId: ctx.id, signalId: s.id });
    return clone(s);
  }

  function addSignals(roundId, signals) {
    var ctx = withActiveRound(roundId);
    if (!ctx.round) return [];
    var added = asArray(signals).map(function (raw) {
      var s = normalizeSignal(raw);
      ctx.round.signals.push(s);
      return s;
    });
    touch(ctx.round);
    commit(ctx.state, { type: 'signals-added', roundId: ctx.id, count: added.length });
    return clone(added);
  }

  function updateSignal(roundId, signalId, patch) {
    var ctx = withActiveRound(roundId);
    if (!ctx.round) return null;
    var found = null;
    for (var i = 0; i < ctx.round.signals.length; i++) {
      if (ctx.round.signals[i].id === signalId) {
        ctx.round.signals[i] = normalizeSignal(
          Object.assign({}, ctx.round.signals[i], patch, { id: signalId }));
        found = ctx.round.signals[i];
        break;
      }
    }
    if (!found) return null;
    touch(ctx.round);
    commit(ctx.state, { type: 'signal-updated', roundId: ctx.id, signalId: signalId });
    return clone(found);
  }

  function removeSignal(roundId, signalId) {
    var ctx = withActiveRound(roundId);
    if (!ctx.round) return false;
    var before = ctx.round.signals.length;
    ctx.round.signals = ctx.round.signals.filter(function (s) {
      return s.id !== signalId;
    });
    // Drop the signal id from any card references.
    ctx.round.cards.forEach(function (c) {
      c.signalIds = c.signalIds.filter(function (id) { return id !== signalId; });
    });
    if (ctx.round.signals.length === before) return false;
    touch(ctx.round);
    commit(ctx.state, { type: 'signal-removed', roundId: ctx.id, signalId: signalId });
    return true;
  }

  /* ----------------------------------------------------------------
   * Cards
   * ---------------------------------------------------------------- */

  function getCards(roundId) {
    var ctx = withActiveRound(roundId);
    return ctx.round ? clone(ctx.round.cards) : [];
  }

  function addCard(roundId, card) {
    var ctx = withActiveRound(roundId);
    if (!ctx.round) return null;
    var c = normalizeCard(card);
    ctx.round.cards.push(c);
    touch(ctx.round);
    commit(ctx.state, { type: 'card-added', roundId: ctx.id, cardId: c.id });
    return clone(c);
  }

  function updateCard(roundId, cardId, patch) {
    var ctx = withActiveRound(roundId);
    if (!ctx.round) return null;
    var found = null;
    for (var i = 0; i < ctx.round.cards.length; i++) {
      if (ctx.round.cards[i].id === cardId) {
        ctx.round.cards[i] = normalizeCard(
          Object.assign({}, ctx.round.cards[i], patch, { id: cardId }));
        found = ctx.round.cards[i];
        break;
      }
    }
    if (!found) return null;
    touch(ctx.round);
    commit(ctx.state, { type: 'card-updated', roundId: ctx.id, cardId: cardId });
    return clone(found);
  }

  function removeCard(roundId, cardId) {
    var ctx = withActiveRound(roundId);
    if (!ctx.round) return false;
    var before = ctx.round.cards.length;
    ctx.round.cards = ctx.round.cards.filter(function (c) { return c.id !== cardId; });
    // Remove votes that reference the deleted card.
    ctx.round.votes = ctx.round.votes.filter(function (v) {
      return v.winnerCardId !== cardId && v.loserCardId !== cardId;
    });
    if (ctx.round.cards.length === before) return false;
    touch(ctx.round);
    commit(ctx.state, { type: 'card-removed', roundId: ctx.id, cardId: cardId });
    return true;
  }

  // Replace the full card set (used by manual grouping + Claude-JSON import).
  function setCards(roundId, cards) {
    var ctx = withActiveRound(roundId);
    if (!ctx.round) return [];
    ctx.round.cards = asArray(cards).map(normalizeCard);
    // Drop votes that now reference cards which no longer exist.
    var ids = {};
    ctx.round.cards.forEach(function (c) { ids[c.id] = true; });
    ctx.round.votes = ctx.round.votes.filter(function (v) {
      return ids[v.winnerCardId] && ids[v.loserCardId];
    });
    touch(ctx.round);
    commit(ctx.state, { type: 'cards-replaced', roundId: ctx.id, count: ctx.round.cards.length });
    return clone(ctx.round.cards);
  }

  // Suggested target card count, mirrored from the cards.js spec:
  // clamp(min(25, ceil(signals/2)), 3, 25).
  function suggestedCardCount(signalCount) {
    var n = Number(signalCount) || 0;
    var target = Math.min(25, Math.ceil(n / 2));
    return clamp(target, 3, 25);
  }

  /* ----------------------------------------------------------------
   * Votes
   * ---------------------------------------------------------------- */

  function getVotes(roundId) {
    var ctx = withActiveRound(roundId);
    return ctx.round ? clone(ctx.round.votes) : [];
  }

  function addVote(roundId, vote) {
    var ctx = withActiveRound(roundId);
    if (!ctx.round) return null;
    if (ctx.round.closed) return null; // honor the round-closed flag
    var v = normalizeVote(vote);
    if (!v.winnerCardId || !v.loserCardId || v.winnerCardId === v.loserCardId) {
      return null;
    }
    ctx.round.votes.push(v);
    touch(ctx.round);
    commit(ctx.state, { type: 'vote-added', roundId: ctx.id, voteId: v.id });
    return clone(v);
  }

  function addVotes(roundId, votes) {
    var ctx = withActiveRound(roundId);
    if (!ctx.round || ctx.round.closed) return [];
    var added = [];
    asArray(votes).forEach(function (raw) {
      var v = normalizeVote(raw);
      if (v.winnerCardId && v.loserCardId && v.winnerCardId !== v.loserCardId) {
        ctx.round.votes.push(v);
        added.push(v);
      }
    });
    touch(ctx.round);
    commit(ctx.state, { type: 'votes-added', roundId: ctx.id, count: added.length });
    return clone(added);
  }

  /* ----------------------------------------------------------------
   * Settings
   * ---------------------------------------------------------------- */

  function getSettings(roundId) {
    var ctx = withActiveRound(roundId);
    if (!ctx.round) {
      return { deptSuppressionThreshold: DEFAULT_DEPT_THRESHOLD, closed: false };
    }
    return {
      deptSuppressionThreshold: ctx.round.settings.deptSuppressionThreshold,
      closed: ctx.round.closed
    };
  }

  function setDeptThreshold(roundId, threshold) {
    return updateRound(roundId, {
      settings: { deptSuppressionThreshold: clamp(threshold, 0, 999) }
    });
  }

  function getDeptThreshold(roundId) {
    var ctx = withActiveRound(roundId);
    return ctx.round
      ? ctx.round.settings.deptSuppressionThreshold
      : DEFAULT_DEPT_THRESHOLD;
  }

  function setRoundClosed(roundId, closed) {
    return updateRound(roundId, { closed: !!closed });
  }

  function isRoundClosed(roundId) {
    var ctx = withActiveRound(roundId);
    return ctx.round ? !!ctx.round.closed : false;
  }

  /* ----------------------------------------------------------------
   * Anonymous voting session id (persists per browser)
   * ---------------------------------------------------------------- */

  function getSessionId() {
    var id = null;
    try { id = global.localStorage.getItem(SESSION_KEY); } catch (e) { /* ignore */ }
    if (!id) {
      id = uid('sess');
      try { global.localStorage.setItem(SESSION_KEY, id); } catch (e) { /* ignore */ }
    }
    return id;
  }

  function newSession() {
    var id = uid('sess');
    try { global.localStorage.setItem(SESSION_KEY, id); } catch (e) { /* ignore */ }
    return id;
  }

  /* ----------------------------------------------------------------
   * Export / Import (round JSON; votes union-merged by id)
   * ---------------------------------------------------------------- */

  function exportRound(roundId) {
    var round = getRound(roundId || getActiveRoundId());
    if (!round) return null;
    return {
      format: 'trenddeck.round',
      version: SCHEMA_VERSION,
      exportedAt: nowISO(),
      round: round
    };
  }

  function exportRoundJSON(roundId, pretty) {
    var payload = exportRound(roundId);
    if (!payload) return '';
    return pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
  }

  function extractRound(payload) {
    if (!payload) return null;
    if (isObject(payload.round)) return payload.round;
    // Accept a bare round object too.
    if (isObject(payload) && (payload.signals || payload.cards || payload.votes || payload.id)) {
      return payload;
    }
    return null;
  }

  function mergeById(existing, incoming) {
    var byId = {};
    var order = [];
    function add(item) {
      if (!item || !item.id) return;
      if (!(item.id in byId)) order.push(item.id);
      byId[item.id] = item;
    }
    asArray(existing).forEach(add);
    asArray(incoming).forEach(add);
    return order.map(function (id) { return byId[id]; });
  }

  /*
   * Import a round payload.
   *  - mode 'merge' (default when a round with the same id exists):
   *      union signals, cards, votes by id into the existing round. This is
   *      the cross-device vote-merge path — votes carry stable ids so the
   *      same vote imported twice is not double-counted.
   *  - mode 'new': always create a fresh round (new id).
   *  - mode 'replace': overwrite the same-id round wholesale.
   */
  function importRound(payloadOrJson, opts) {
    opts = opts || {};
    var payload = payloadOrJson;
    if (typeof payloadOrJson === 'string') {
      try { payload = JSON.parse(payloadOrJson); }
      catch (e) { return { ok: false, error: 'Invalid JSON: ' + e.message }; }
    }
    var incoming = extractRound(payload);
    if (!incoming) {
      return { ok: false, error: 'Not a TrendDeck round file.' };
    }
    incoming = normalizeRound(incoming);

    var state = getState();
    var mode = opts.mode;
    var targetId = incoming.id;
    var existing = state.rounds[targetId];

    if (mode === 'new' || (!existing && opts.forceNew)) {
      incoming.id = uid('round');
      incoming.isSample = false;
      state.rounds[incoming.id] = incoming;
      state.activeRoundId = incoming.id;
      commit(state, { type: 'round-imported', roundId: incoming.id, mode: 'new' });
      return { ok: true, mode: 'new', roundId: incoming.id, round: clone(incoming) };
    }

    if (!existing) {
      // No same-id round yet — just add it.
      state.rounds[incoming.id] = incoming;
      if (opts.activate !== false) state.activeRoundId = incoming.id;
      commit(state, { type: 'round-imported', roundId: incoming.id, mode: 'add' });
      return { ok: true, mode: 'add', roundId: incoming.id, round: clone(incoming) };
    }

    if (mode === 'replace') {
      state.rounds[targetId] = incoming;
      if (opts.activate !== false) state.activeRoundId = targetId;
      commit(state, { type: 'round-imported', roundId: targetId, mode: 'replace' });
      return { ok: true, mode: 'replace', roundId: targetId, round: clone(incoming) };
    }

    // Default: merge by id (signals, cards, votes).
    var prevVotes = existing.votes.length;
    existing.signals = mergeById(existing.signals, incoming.signals);
    existing.cards = mergeById(existing.cards, incoming.cards);
    existing.votes = mergeById(existing.votes, incoming.votes);
    // Keep the more descriptive name if the local one is still default.
    if ((!existing.name || /untitled/i.test(existing.name)) && incoming.name) {
      existing.name = incoming.name;
    }
    existing.isSample = existing.isSample && incoming.isSample;
    touch(existing);
    if (opts.activate !== false) state.activeRoundId = targetId;
    commit(state, { type: 'round-imported', roundId: targetId, mode: 'merge' });
    return {
      ok: true,
      mode: 'merge',
      roundId: targetId,
      votesAdded: existing.votes.length - prevVotes,
      round: clone(existing)
    };
  }

  /* ----------------------------------------------------------------
   * Share-link encode / decode
   * ---------------------------------------------------------------- */

  // Produce just the hash fragment payload (e.g. "share=...").
  function encodeShareFragment(roundId) {
    var payload = exportRound(roundId);
    if (!payload) return '';
    var json = JSON.stringify(payload);
    return 'share=' + toUrlSafe(utf8ToB64(json));
  }

  // Produce a full shareable URL using the current page as the base.
  function encodeShareLink(roundId, baseUrl) {
    var frag = encodeShareFragment(roundId);
    if (!frag) return '';
    var base = baseUrl;
    if (!base) {
      try {
        base = global.location.origin + global.location.pathname;
      } catch (e) {
        base = '';
      }
    }
    return base + '#' + frag;
  }

  // Decode a share fragment / full URL / raw token back into a round payload.
  function decodeShareLink(input) {
    if (!input) return null;
    var token = String(input);
    var hashIdx = token.indexOf('#');
    if (hashIdx >= 0) token = token.slice(hashIdx + 1);
    // Strip a leading "share=" (and any other hash params).
    var parts = token.split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (kv[0] === 'share' && kv[1]) { token = kv[1]; break; }
    }
    // If still looks like key=value with no share key, give up gracefully.
    if (token.indexOf('=') >= 0 && token.indexOf('share=') < 0) {
      // token may itself be "share=xyz" handled above; otherwise bail.
    }
    try {
      var json = b64ToUtf8(fromUrlSafe(token));
      var payload = JSON.parse(json);
      var round = extractRound(payload);
      return round ? normalizeRound(round) : null;
    } catch (e) {
      return null;
    }
  }

  // Convenience: read a share link from the current location hash and import it.
  function consumeShareFromLocation(opts) {
    var hash = '';
    try { hash = global.location.hash || ''; } catch (e) { hash = ''; }
    if (hash.indexOf('share=') < 0) return null;
    var round = decodeShareLink(hash);
    if (!round) return null;
    return importRound({ round: round }, opts || {});
  }

  /* ----------------------------------------------------------------
   * Public API
   * ---------------------------------------------------------------- */

  var Store = {
    // lifecycle / meta
    SCHEMA_VERSION: SCHEMA_VERSION,
    DEFAULT_DEPT_THRESHOLD: DEFAULT_DEPT_THRESHOLD,
    init: getState,            // alias — forces seeding + returns state
    getState: getState,
    subscribe: subscribe,
    emit: emit,
    uid: uid,

    // rounds
    listRounds: listRounds,
    getRound: getRound,
    getActiveRound: getActiveRound,
    getActiveRoundId: getActiveRoundId,
    setActiveRound: setActiveRound,
    createRound: createRound,
    updateRound: updateRound,
    renameRound: renameRound,
    deleteRound: deleteRound,
    resetToSample: resetToSample,
    clearAll: clearAll,

    // signals
    getSignals: getSignals,
    addSignal: addSignal,
    addSignals: addSignals,
    updateSignal: updateSignal,
    removeSignal: removeSignal,

    // cards
    getCards: getCards,
    addCard: addCard,
    updateCard: updateCard,
    removeCard: removeCard,
    setCards: setCards,
    suggestedCardCount: suggestedCardCount,

    // votes
    getVotes: getVotes,
    addVote: addVote,
    addVotes: addVotes,
    pairKeyFor: pairKeyFor,

    // settings
    getSettings: getSettings,
    setDeptThreshold: setDeptThreshold,
    getDeptThreshold: getDeptThreshold,
    setRoundClosed: setRoundClosed,
    isRoundClosed: isRoundClosed,

    // session
    getSessionId: getSessionId,
    newSession: newSession,

    // export / import
    exportRound: exportRound,
    exportRoundJSON: exportRoundJSON,
    importRound: importRound,

    // share links
    encodeShareLink: encodeShareLink,
    encodeShareFragment: encodeShareFragment,
    decodeShareLink: decodeShareLink,
    consumeShareFromLocation: consumeShareFromLocation
  };

  global.Store = Store;

})(typeof window !== 'undefined' ? window : this);
