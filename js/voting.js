/*
 * TrendDeck — js/voting.js
 * ------------------------------------------------------------------
 * Voting flow for a single studio trend-voting round.
 *
 * Responsibilities (see manifest):
 *   - Generate 6-10 unique random trend-card pairs per anonymous session.
 *   - Optional department self-report before voting starts.
 *   - Head-to-head A/B click-through with a live streak counter.
 *   - Persist each vote via store.js (with a localStorage fallback).
 *   - Honor the round-closed flag by showing a read-only message
 *     instead of the voting UI.
 *
 * This module is intentionally defensive about the exact store.js API
 * so it stays self-consistent even as sibling files evolve. It exposes
 * a single global, `window.Voting`, with a `render(mount)` entry point
 * that the SPA router (in index.html) calls when the #/vote view is
 * active. It also self-binds to hashchange as a graceful fallback.
 * ------------------------------------------------------------------
 */
(function () {
  'use strict';

  // ---- Constants -------------------------------------------------

  var MIN_PAIRS = 6;
  var MAX_PAIRS = 10;
  var SESSION_KEY = 'trenddeck.voteSession.v1';

  // Departments offered for optional self-report. The round may extend
  // this list via round.departments; "Prefer not to say" stays anonymous.
  var DEFAULT_DEPARTMENTS = [
    'Design',
    'Merchandising',
    'Marketing',
    'Product',
    'Editorial',
    'Leadership'
  ];
  var ANON_DEPT = 'Prefer not to say';

  // ---- Tiny utilities --------------------------------------------

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function randomId(prefix) {
    return (prefix || 'id') + '_' +
      Date.now().toString(36) + '_' +
      Math.random().toString(36).slice(2, 9);
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function isHttpUrl(value) {
    return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
  }

  function safeHostname(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
      return url;
    }
  }

  // ---- Store adapter ---------------------------------------------
  // Wrap whatever store.js exposes, falling back to direct localStorage
  // so the voting view never hard-crashes if a method name differs.

  function getStore() {
    return window.Store || window.store || window.TrendDeckStore || null;
  }

  function getRound() {
    // Resolve the active round ONLY through the store — no divergent
    // localStorage fallback that could mask a failed write.
    var s = getStore();
    if (s) {
      try {
        if (typeof s.getActiveRound === 'function') return s.getActiveRound();
        if (typeof s.getCurrentRound === 'function') return s.getCurrentRound();
        if (typeof s.getRound === 'function') return s.getRound();
        if (s.round) return s.round;
      } catch (e) { /* fall through */ }
    }
    return null;
  }

  // store.addVote(roundId, vote) is roundId-first; pass null to mean
  // "active round". Returns the saved vote on success, or null on rejection
  // (closed round, invalid/equal card ids, or no active round). No
  // localStorage fallback — a failed write must surface, never be masked.
  function persistVote(vote) {
    var s = getStore();
    if (s && typeof s.addVote === 'function') {
      return s.addVote(null, vote);
    }
    return null;
  }

  function getRoundId(round) {
    return (round && (round.id || round.roundId || round.slug)) || 'round';
  }

  function getSettings(round) {
    if (!round) return {};
    return round.settings || round.config || round.meta || {};
  }

  function isRoundClosed(round) {
    var settings = getSettings(round);
    var s = getStore();
    if (s && typeof s.isRoundClosed === 'function') {
      try { return !!s.isRoundClosed(); } catch (e) { /* ignore */ }
    }
    return !!(settings.roundClosed || settings.closed ||
              (round && (round.closed || round.roundClosed)) ||
              settings.status === 'closed');
  }

  function getCards(round) {
    if (!round) return [];
    var cards = round.cards || round.trendCards || round.trend_cards || [];
    return Array.isArray(cards) ? cards.filter(Boolean) : [];
  }

  function getDepartments(round) {
    var list = [];
    if (round && Array.isArray(round.departments) && round.departments.length) {
      list = round.departments.slice();
    } else {
      list = DEFAULT_DEPARTMENTS.slice();
    }
    // Merge any departments already present in recorded votes.
    if (round && Array.isArray(round.votes)) {
      round.votes.forEach(function (v) {
        var d = v && v.department;
        if (d && d !== ANON_DEPT && list.indexOf(d) === -1) list.push(d);
      });
    }
    return list;
  }

  function cardId(card) {
    return card && (card.id || card.cardId || card.label);
  }

  function cardLabel(card) {
    return (card && (card.label || card.name || card.title)) || 'Untitled trend';
  }

  function cardRationale(card) {
    return (card && (card.rationale || card.summary || card.description)) || '';
  }

  function cardThumb(card) {
    var url = card && (card.thumbnail || card.thumbnailUrl ||
      card.thumbnail_url || card.image || card.imageUrl);
    if (isHttpUrl(url)) {
      return '<div class="vote-card__thumb">' +
        '<img src="' + escapeHtml(url) + '" alt="" loading="lazy" ' +
        'onerror="this.style.display=&#39;none&#39;;' +
        'this.parentNode.classList.add(&#39;vote-card__thumb--missing&#39;)">' +
        '</div>';
    }
    // Fallback to a labeled link/source chip.
    var sources = collectSources(card);
    var chip = sources.length
      ? escapeHtml(sources[0])
      : 'No preview';
    return '<div class="vote-card__thumb vote-card__thumb--missing">' +
      '<span class="vote-card__chip">' + chip + '</span></div>';
  }

  function collectSources(card) {
    var out = [];
    if (!card) return out;
    var sources = card.sources || card.platforms || card.sourceBreakdown ||
      card.source_breakdown;
    if (Array.isArray(sources)) {
      sources.forEach(function (s) {
        if (typeof s === 'string') out.push(s);
        else if (s && s.platform) out.push(s.platform);
        else if (s && s.name) out.push(s.name);
        else if (s && s.url) out.push(safeHostname(s.url));
      });
    } else if (sources && typeof sources === 'object') {
      Object.keys(sources).forEach(function (k) { out.push(k); });
    }
    // Derive from grouped signals if present.
    if (!out.length && Array.isArray(card.signals)) {
      card.signals.forEach(function (sig) {
        var u = sig && (sig.url || sig.source);
        if (isHttpUrl(u)) out.push(safeHostname(u));
        else if (typeof sig === 'string') out.push(sig);
      });
    }
    // De-dupe.
    return out.filter(function (v, i) { return v && out.indexOf(v) === i; });
  }

  // ---- Session state ---------------------------------------------

  function loadSession(roundId) {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj && obj.roundId === roundId && Array.isArray(obj.pairs)) {
          return obj;
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function saveSession(session) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (e) { /* ignore */ }
  }

  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }

  // Coverage-aware selection of 6-10 unique unordered pairs.
  function selectPairs(cards) {
    var ids = cards.map(cardId).filter(Boolean);
    var all = [];
    for (var i = 0; i < ids.length; i++) {
      for (var j = i + 1; j < ids.length; j++) {
        all.push([ids[i], ids[j]]);
      }
    }
    if (!all.length) return [];
    shuffle(all);

    var maxPairs = all.length;
    var desired = MIN_PAIRS + Math.floor(Math.random() * (MAX_PAIRS - MIN_PAIRS + 1));
    var count = clamp(desired, Math.min(MIN_PAIRS, maxPairs), Math.min(MAX_PAIRS, maxPairs));
    count = Math.min(count, maxPairs);

    // Greedy pick favoring cards that have appeared least often, so the
    // session spreads across the gallery instead of repeating two cards.
    var appear = {};
    ids.forEach(function (id) { appear[id] = 0; });
    var pool = all.slice();
    var chosen = [];
    while (chosen.length < count && pool.length) {
      pool.sort(function (p, q) {
        return (appear[p[0]] + appear[p[1]]) - (appear[q[0]] + appear[q[1]]);
      });
      var pick = pool.shift();
      chosen.push(pick);
      appear[pick[0]] += 1;
      appear[pick[1]] += 1;
    }
    return chosen;
  }

  function startSession(round, department) {
    var cards = getCards(round);
    var pairs = selectPairs(cards);
    var session = {
      roundId: getRoundId(round),
      sessionId: randomId('sess'),
      department: department || ANON_DEPT,
      pairs: pairs,
      index: 0,
      streak: 0,
      bestStreak: 0,
      voted: 0,
      skipped: 0,
      started: true,
      finished: false
    };
    saveSession(session);
    return session;
  }

  // ---- Rendering -------------------------------------------------

  function resolveMount(mount) {
    if (mount && mount.nodeType === 1) return mount;
    // The router mounts the Vote view into #voting-root; prefer it so internal
    // re-renders (after a pick/skip) stay scoped to the view body.
    return document.getElementById('voting-root') ||
      document.getElementById('view') ||
      document.querySelector('[data-view-mount]') ||
      document.getElementById('vote') ||
      document.getElementById('app');
  }

  function navigate(hash) {
    if (window.location.hash !== hash) {
      window.location.hash = hash;
    } else {
      render();
    }
  }

  function render(mount) {
    var el = resolveMount(mount);
    if (!el) return;

    var round = getRound();

    if (!round) {
      el.innerHTML = emptyStateHtml(
        'No round loaded',
        'Create or import a round to start voting.',
        '#/round', 'Go to Round setup'
      );
      return;
    }

    // Read-only mode when the admin has closed the round.
    if (isRoundClosed(round)) {
      el.innerHTML = closedHtml(round);
      wireClosed(el);
      return;
    }

    var cards = getCards(round);
    if (cards.length < 2) {
      el.innerHTML = emptyStateHtml(
        'Not enough trend cards',
        'Voting needs at least two trend cards. Group your signals into ' +
        'cards first, then come back to vote.',
        '#/cards', 'Go to Trend Cards'
      );
      return;
    }

    var session = loadSession(getRoundId(round));

    if (!session || !session.started) {
      el.innerHTML = introHtml(round, cards);
      wireIntro(el, round);
      return;
    }

    if (session.finished || session.index >= session.pairs.length) {
      session.finished = true;
      saveSession(session);
      el.innerHTML = doneHtml(round, session);
      wireDone(el, round);
      return;
    }

    el.innerHTML = matchupHtml(round, cards, session);
    wireMatchup(el, round, cards, session);
  }

  // ---- View: empty / closed --------------------------------------

  function emptyStateHtml(title, body, hash, cta) {
    return '' +
      '<section class="view view--vote">' +
      '  <div class="vote-empty card-panel">' +
      '    <h2>' + escapeHtml(title) + '</h2>' +
      '    <p>' + escapeHtml(body) + '</p>' +
      (hash ? '    <a class="btn btn--primary" href="' + escapeHtml(hash) + '">' +
        escapeHtml(cta) + '</a>' : '') +
      '  </div>' +
      '</section>';
  }

  function closedHtml(round) {
    var totalVotes = Array.isArray(round.votes) ? round.votes.length : 0;
    return '' +
      '<section class="view view--vote view--vote-closed">' +
      '  <div class="vote-closed card-panel">' +
      '    <div class="vote-closed__badge">Voting closed</div>' +
      '    <h2>This round is no longer accepting votes</h2>' +
      '    <p>The admin has closed voting for ' +
           '<strong>' + escapeHtml(round.name || round.title || 'this round') +
           '</strong>. ' +
      '       ' + totalVotes + ' vote' + (totalVotes === 1 ? '' : 's') +
      '       were recorded. You can still review the consensus results.</p>' +
      '    <div class="vote-closed__actions">' +
      '      <a class="btn btn--primary" href="#/dashboard">View results dashboard</a>' +
      '      <a class="btn btn--ghost" href="#/brief">Open Trend Brief</a>' +
      '    </div>' +
      '  </div>' +
      '</section>';
  }

  function wireClosed() { /* purely navigational links, nothing to wire */ }

  // ---- View: intro / department self-report ----------------------

  function introHtml(round, cards) {
    var depts = getDepartments(round);
    var existing = loadSession(getRoundId(round));
    var current = (existing && existing.department) || ANON_DEPT;
    var options = [ANON_DEPT].concat(depts).map(function (d) {
      var sel = d === current ? ' selected' : '';
      return '<option value="' + escapeHtml(d) + '"' + sel + '>' +
        escapeHtml(d) + '</option>';
    }).join('');

    var sampleNote = round.sample || round.isSample || round.example
      ? '<p class="vote-intro__sample-note">You are looking at the bundled ' +
        '<strong>example round</strong>. Your votes are saved locally and ' +
        'are clearly labeled as sample data until you start your own round.</p>'
      : '';

    return '' +
      '<section class="view view--vote">' +
      '  <div class="vote-intro card-panel">' +
      '    <p class="vote-intro__eyebrow">Head-to-head voting</p>' +
      '    <h2>Pick the trend you would back</h2>' +
      '    <p class="vote-intro__lede">You will see ' + MIN_PAIRS + '\u2013' +
             MAX_PAIRS + ' random match-ups from the ' + cards.length +
             ' trend cards in this round. Click the card you would rather see ' +
             'the studio build a story around. Keep a voting streak going \u2014 ' +
             'skipping a match-up resets it.</p>' +
      sampleNote +
      '    <form class="vote-intro__form" id="voteStartForm">' +
      '      <label class="field">' +
      '        <span class="field__label">Your department <em>(optional)</em></span>' +
      '        <select id="voteDept" class="field__input">' + options + '</select>' +
      '        <span class="field__hint">Used only for the by-department ' +
               'breakdown. Votes stay anonymous \u2014 no names are stored.</span>' +
      '      </label>' +
      '      <button type="submit" class="btn btn--primary btn--lg">Start voting</button>' +
      '    </form>' +
      '  </div>' +
      '</section>';
  }

  function wireIntro(el, round) {
    var form = el.querySelector('#voteStartForm');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var sel = el.querySelector('#voteDept');
      var dept = sel ? sel.value : ANON_DEPT;
      startSession(round, dept);
      render();
    });
  }

  // ---- View: matchup ---------------------------------------------

  function findCard(cards, id) {
    for (var i = 0; i < cards.length; i++) {
      if (cardId(cards[i]) === id) return cards[i];
    }
    return null;
  }

  function voteCardHtml(card, side) {
    var sources = collectSources(card);
    var chips = sources.slice(0, 4).map(function (s) {
      return '<span class="vote-card__source">' + escapeHtml(s) + '</span>';
    }).join('');
    var rationale = cardRationale(card);

    return '' +
      '<button type="button" class="vote-card vote-card--' + side + '" ' +
        'data-card-id="' + escapeHtml(cardId(card)) + '">' +
      '  <span class="vote-card__side-tag">' + side.toUpperCase() + '</span>' +
      cardThumb(card) +
      '  <span class="vote-card__body">' +
      '    <span class="vote-card__label">' + escapeHtml(cardLabel(card)) + '</span>' +
      (rationale
        ? '    <span class="vote-card__rationale">' + escapeHtml(rationale) + '</span>'
        : '') +
      (chips ? '    <span class="vote-card__sources">' + chips + '</span>' : '') +
      '    <span class="vote-card__pick">Pick this trend</span>' +
      '  </span>' +
      '</button>';
  }

  function streakBadge(session) {
    var s = session.streak || 0;
    var flames = '';
    var count = Math.min(s, 5);
    for (var i = 0; i < count; i++) flames += '\uD83D\uDD25';
    var hot = s >= 3 ? ' is-hot' : '';
    return '' +
      '<div class="vote-streak' + hot + '" aria-live="polite">' +
      '  <span class="vote-streak__flames">' + (flames || '\u2728') + '</span>' +
      '  <span class="vote-streak__count">' + s + '</span>' +
      '  <span class="vote-streak__label">streak</span>' +
      '</div>';
  }

  function matchupHtml(round, cards, session) {
    var pair = session.pairs[session.index];
    var a = findCard(cards, pair[0]);
    var b = findCard(cards, pair[1]);

    // If a card was deleted mid-session, skip this pair gracefully.
    if (!a || !b) {
      session.index += 1;
      saveSession(session);
      return matchupHtml(round, cards, session.index < session.pairs.length
        ? session
        : (session.finished = true, session));
    }

    var total = session.pairs.length;
    var current = session.index + 1;
    var pct = Math.round(((session.index) / total) * 100);

    var deptLine = session.department && session.department !== ANON_DEPT
      ? '<span class="vote-meta__dept">Voting as ' +
          escapeHtml(session.department) + '</span>'
      : '<span class="vote-meta__dept">Anonymous</span>';

    return '' +
      '<section class="view view--vote view--matchup">' +
      '  <header class="vote-head">' +
      '    <div class="vote-progress">' +
      '      <div class="vote-progress__bar"><span style="width:' + pct + '%"></span></div>' +
      '      <div class="vote-progress__text">Match-up ' + current + ' of ' + total + '</div>' +
      '    </div>' +
      streakBadge(session) +
      '  </header>' +
      '  <div class="vote-arena">' +
      voteCardHtml(a, 'a') +
      '    <div class="vote-arena__vs" aria-hidden="true">VS</div>' +
      voteCardHtml(b, 'b') +
      '  </div>' +
      '  <footer class="vote-foot">' +
      '    ' + deptLine +
      '    <button type="button" class="btn btn--ghost" id="voteSkip">' +
             'Skip (resets streak)</button>' +
      '    <button type="button" class="btn btn--link" id="voteRestart">' +
             'Restart session</button>' +
      '  </footer>' +
      '</section>';
  }

  function wireMatchup(el, round, cards, session) {
    var buttons = el.querySelectorAll('.vote-card');
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.addEventListener('click', function () {
        var winnerId = btn.getAttribute('data-card-id');
        btn.classList.add('is-picked');
        // recordPick re-renders itself on rejection (closed view or inline
        // banner); only re-render here on a successful, advanced vote.
        if (recordPick(round, session, winnerId)) render();
      });
    });

    var skip = el.querySelector('#voteSkip');
    if (skip) {
      skip.addEventListener('click', function () {
        session.index += 1;
        session.skipped += 1;
        session.streak = 0;
        if (session.index >= session.pairs.length) session.finished = true;
        saveSession(session);
        render();
      });
    }

    var restart = el.querySelector('#voteRestart');
    if (restart) {
      restart.addEventListener('click', function () {
        clearSession();
        render();
      });
    }
  }

  function recordPick(round, session, winnerId) {
    var pair = session.pairs[session.index];
    var loserId = pair[0] === winnerId ? pair[1] : pair[0];

    // Speak the store's real normalizeVote contract: winnerCardId/loserCardId,
    // department, sessionId. Do NOT send winnerId/loserId/roundId/ts/id — the
    // store ignores them and stamps its own id/createdAt/pairKey.
    var vote = {
      winnerCardId: winnerId,
      loserCardId: loserId,
      department: session.department || ANON_DEPT,
      sessionId: session.sessionId
    };

    var saved = persistVote(vote);
    if (!saved) {
      handleVoteRejected(round, session);
      return false;
    }

    // Only advance the session after a truthy persist so the streak counter
    // and the "votes are in" screen can never report a discarded vote.
    session.index += 1;
    session.voted += 1;
    session.streak = (session.streak || 0) + 1;
    if (session.streak > (session.bestStreak || 0)) {
      session.bestStreak = session.streak;
    }
    if (session.index >= session.pairs.length) session.finished = true;
    saveSession(session);
    return true;
  }

  // A vote write failed. If the round is now closed, paint the read-only
  // closed view. Otherwise surface a non-blocking error and do NOT advance.
  function handleVoteRejected(round, session) {
    if (isRoundClosed(round)) {
      clearSession();
      render();
      return;
    }
    var msg = 'Could not save that vote. Your round may be closed or storage ' +
      'is full — refresh and try again.';
    if (window.TrendDeck && typeof window.TrendDeck.toast === 'function') {
      window.TrendDeck.toast(msg);
      return;
    }
    // Fallback: inject a single dismissible banner at the top of the matchup.
    var el = resolveMount();
    if (!el) return;
    var arena = el.querySelector('.view--matchup') || el;
    if (arena.querySelector('.banner-error')) return;
    var banner = document.createElement('div');
    banner.className = 'banner banner-error';
    banner.setAttribute('role', 'alert');
    banner.innerHTML = '<span>' + escapeHtml(msg) + '</span>';
    arena.insertBefore(banner, arena.firstChild);
  }

  // ---- View: done ------------------------------------------------

  function doneHtml(round, session) {
    var voted = session.voted || 0;
    var best = session.bestStreak || 0;
    var deptLine = session.department && session.department !== ANON_DEPT
      ? 'Recorded as <strong>' + escapeHtml(session.department) + '</strong>.'
      : 'Recorded anonymously.';

    return '' +
      '<section class="view view--vote view--vote-done">' +
      '  <div class="vote-done card-panel">' +
      '    <div class="vote-done__check">\u2713</div>' +
      '    <h2>Thanks \u2014 your votes are in</h2>' +
      '    <p>You voted on <strong>' + voted + '</strong> match-up' +
           (voted === 1 ? '' : 's') + '. Best streak: <strong>' + best +
           ' \uD83D\uDD25</strong>. ' + deptLine + '</p>' +
      '    <p class="vote-done__hint">Every vote is stored in this browser. ' +
           'To combine votes from other people, the admin can export this ' +
           'round and merge the files, or share the round link.</p>' +
      '    <div class="vote-done__actions">' +
      '      <a class="btn btn--primary" href="#/dashboard">See live results</a>' +
      '      <button type="button" class="btn btn--ghost" id="voteAgain">' +
             'Vote again (new session)</button>' +
      '    </div>' +
      '  </div>' +
      '</section>';
  }

  function wireDone(el, round) {
    var again = el.querySelector('#voteAgain');
    if (!again) return;
    again.addEventListener('click', function () {
      clearSession();
      startSession(round, round && getCards(round).length ? null : null);
      // Re-show the intro so the voter can re-confirm their department.
      clearSession();
      render();
    });
  }

  // ---- Routing / public API --------------------------------------

  function isVoteHash() {
    var h = (window.location.hash || '').toLowerCase();
    return h.indexOf('vote') !== -1;
  }

  function autoRender() {
    // Defer to index.html's hash router when present (it drives rendering via
    // the `trenddeck:render` event into #voting-root).
    if (window.TrendDeck && typeof window.TrendDeck.refresh === 'function') return;
    if (isVoteHash()) {
      render();
    }
  }

  window.Voting = {
    render: render,
    refresh: render,
    init: render,
    startSession: function () {
      var round = getRound();
      if (round) startSession(round, null);
    },
    clearSession: clearSession
  };

  // index.html's hash router fires `trenddeck:render` with detail.route when a
  // view becomes active; render into #voting-root so the ballot paints on the
  // initial route and on every nav change.
  document.addEventListener('trenddeck:render', function (ev) {
    var route = String((ev && ev.detail && ev.detail.route) || '').toLowerCase();
    if (route.indexOf('vote') === -1) return;
    var root = document.getElementById('voting-root');
    if (root) render(root);
  });

  // Graceful fallback if the SPA shell does not explicitly call render():
  // self-bind to hash changes and initial load when the vote view is active.
  window.addEventListener('hashchange', autoRender);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoRender);
  } else {
    autoRender();
  }
})();
