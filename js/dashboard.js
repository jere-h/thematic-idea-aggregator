/*
 * TrendDeck — js/dashboard.js
 * ----------------------------------------------------------------------------
 * Consensus dashboard + two-page Trend Brief.
 *
 * Responsibilities:
 *   - Win-rate leaderboard with per-card vote counts and appearances.
 *   - By-department breakdown with admin-set small-department suppression.
 *   - Card thumbnails + rationale rendering (with graceful link-chip fallback).
 *   - "Export Trend Brief" -> builds the print-styled two-page view and calls
 *     window.print(); optional jsPDF export when the library is present.
 *
 * This module is defensive about the store API and the data model so it works
 * whether the active round comes from js/store.js (window.Store / window.store)
 * or, as a last resort, from the bundled sample round in js/sample-data.js.
 *
 * Public surface (window.Dashboard):
 *   render(container?)      -> render the consensus dashboard view
 *   renderBrief(container?) -> render the standalone brief preview view
 *   exportBrief()           -> open print-styled two-page view + window.print()
 *   exportPDF()             -> optional jsPDF export (no-op w/ notice if absent)
 *   computeLeaderboard(round)
 *   computeDepartments(round)
 */
(function (global) {
  'use strict';

  // Below ~12 recorded votes the head-to-head spread is statistically trivial
  // for a studio round (~one voter completing one MIN_PAIRS=6 session twice).
  var LOW_CONFIDENCE_VOTES = 12;

  /* ------------------------------------------------------------------ *
   * Store / round access (defensive across possible store shapes)
   * ------------------------------------------------------------------ */

  function getStore() {
    return global.Store || global.store || null;
  }

  function getRound() {
    var s = getStore();
    if (s) {
      var getters = [
        'getActiveRound', 'getCurrentRound', 'getRound',
        'activeRound', 'currentRound', 'load'
      ];
      for (var i = 0; i < getters.length; i++) {
        var fn = s[getters[i]];
        if (typeof fn === 'function') {
          try {
            var r = fn.call(s);
            if (r) return normalizeRound(r);
          } catch (e) { /* try next */ }
        }
      }
      // property-style access
      if (s.round) return normalizeRound(s.round);
      if (s.activeRound && typeof s.activeRound !== 'function') {
        return normalizeRound(s.activeRound);
      }
    }
    // Last-resort fallback: the bundled sample round.
    var sample = global.SAMPLE_ROUND || global.sampleRound ||
                 (global.SampleData && global.SampleData.round) || null;
    return sample ? normalizeRound(sample) : null;
  }

  function getSettings(round) {
    var s = getStore();
    var fromStore = null;
    if (s && typeof s.getSettings === 'function') {
      try { fromStore = s.getSettings(); } catch (e) { fromStore = null; }
    }
    var settings = fromStore || (round && round.settings) || {};
    return {
      deptSuppressionThreshold:
        numberOr(settings.deptSuppressionThreshold,
          numberOr(settings.deptThreshold,
            numberOr(settings.smallDeptThreshold, 3))),
      roundClosed: !!(settings.roundClosed || (round && round.closed))
    };
  }

  function normalizeRound(r) {
    if (!r || typeof r !== 'object') return r;
    // Ensure arrays exist so downstream code never crashes.
    r.signals = Array.isArray(r.signals) ? r.signals : (r.signals || []);
    r.cards = Array.isArray(r.cards) ? r.cards :
              (Array.isArray(r.trendCards) ? r.trendCards :
               Array.isArray(r.trend_cards) ? r.trend_cards : []);
    r.votes = Array.isArray(r.votes) ? r.votes : [];
    return r;
  }

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */

  function numberOr(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function pct(x) {
    return Math.round((x || 0) * 100);
  }

  function firstOf(obj /*, keys... */) {
    for (var i = 1; i < arguments.length; i++) {
      var k = arguments[i];
      if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') {
        return obj[k];
      }
    }
    return undefined;
  }

  function cardId(card) {
    return firstOf(card, 'id', 'cardId', 'card_id', 'key', 'slug', 'label');
  }

  function cardLabel(card) {
    return firstOf(card, 'label', 'name', 'title', 'id') || 'Untitled trend';
  }

  function cardRationale(card) {
    return firstOf(card, 'rationale', 'why', 'summary', 'description', 'desc') || '';
  }

  function cardScore(card) {
    var s = firstOf(card, 'score', 'compositeScore', 'composite_score', 'compositeScore');
    return (s === undefined) ? null : Number(s);
  }

  function cardThumb(card) {
    return firstOf(card, 'thumbnail', 'thumb', 'thumbUrl', 'thumbnailUrl',
      'image', 'imageUrl', 'img');
  }

  function cardSignals(card) {
    var sig = firstOf(card, 'signals', 'members', 'signalIds', 'signal_ids', 'items');
    return Array.isArray(sig) ? sig : [];
  }

  // Source / platform breakdown -> normalized [{label, count}]
  function cardSources(card) {
    var src = firstOf(card, 'sourceBreakdown', 'source_breakdown', 'sources',
      'platforms', 'platformBreakdown');
    var out = [];
    if (!src) return out;
    if (Array.isArray(src)) {
      src.forEach(function (item) {
        if (typeof item === 'string') {
          out.push({ label: item, count: 1 });
        } else if (item && typeof item === 'object') {
          out.push({
            label: firstOf(item, 'label', 'name', 'platform', 'source') || '—',
            count: numberOr(firstOf(item, 'count', 'n', 'value'), 1)
          });
        }
      });
    } else if (typeof src === 'object') {
      Object.keys(src).forEach(function (k) {
        out.push({ label: k, count: numberOr(src[k], 1) });
      });
    }
    return out;
  }

  function voteWinner(v) {
    return firstOf(v, 'winnerId', 'winner', 'winnerCardId', 'winner_card_id',
      'won', 'choice', 'pick');
  }

  function voteLoser(v) {
    return firstOf(v, 'loserId', 'loser', 'loserCardId', 'loser_card_id', 'lost');
  }

  // A vote may store the pair explicitly; if loser is missing, infer from pair.
  function votePair(v) {
    var pair = firstOf(v, 'pair', 'cards', 'pairIds');
    if (Array.isArray(pair) && pair.length >= 2) {
      return [pair[0], pair[1]].map(function (p) {
        return (p && typeof p === 'object') ? cardId(p) : p;
      });
    }
    var a = firstOf(v, 'a', 'cardA', 'aId', 'leftId', 'left');
    var b = firstOf(v, 'b', 'cardB', 'bId', 'rightId', 'right');
    if (a !== undefined && b !== undefined) return [a, b];
    return null;
  }

  function voteDepartment(v) {
    var d = firstOf(v, 'department', 'dept', 'team', 'group');
    if (!d) return 'Unspecified';
    return String(d).trim() || 'Unspecified';
  }

  /* ------------------------------------------------------------------ *
   * Stats computation
   * ------------------------------------------------------------------ */

  function buildCardIndex(round) {
    var index = {};
    (round.cards || []).forEach(function (c) {
      var id = cardId(c);
      if (id === undefined) return;
      index[String(id)] = c;
    });
    return index;
  }

  function computeLeaderboard(round) {
    round = round || getRound();
    if (!round) return [];
    var index = buildCardIndex(round);
    var stats = {};

    (round.cards || []).forEach(function (c) {
      var id = String(cardId(c));
      stats[id] = { card: c, wins: 0, losses: 0, appearances: 0 };
    });

    (round.votes || []).forEach(function (v) {
      var w = voteWinner(v);
      var l = voteLoser(v);
      var pair = votePair(v);
      if (l === undefined && pair && w !== undefined) {
        // infer loser as the "other" card in the pair
        l = (String(pair[0]) === String(w)) ? pair[1] : pair[0];
      }
      if (w !== undefined && stats[String(w)]) {
        stats[String(w)].wins++;
        stats[String(w)].appearances++;
      }
      if (l !== undefined && stats[String(l)]) {
        stats[String(l)].losses++;
        stats[String(l)].appearances++;
      }
    });

    var rows = Object.keys(stats).map(function (id) {
      var s = stats[id];
      s.winRate = s.appearances ? s.wins / s.appearances : 0;
      s.cardId = id;
      return s;
    });

    rows.sort(function (a, b) {
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.appearances - a.appearances;
    });

    rows.forEach(function (r, i) { r.rank = i + 1; });
    return rows;
  }

  function computeDepartments(round) {
    round = round || getRound();
    if (!round) return { departments: [], suppressed: [], threshold: 0 };
    var settings = getSettings(round);
    var threshold = settings.deptSuppressionThreshold;
    var index = buildCardIndex(round);

    var groups = {}; // dept -> { votes:[], cardStats:{} , voters:Set }

    (round.votes || []).forEach(function (v) {
      var dept = voteDepartment(v);
      if (!groups[dept]) {
        groups[dept] = { dept: dept, votes: 0, voters: {}, cardStats: {} };
      }
      var g = groups[dept];
      g.votes++;
      var session = firstOf(v, 'sessionId', 'session', 'voterId', 'voter') || ('v' + g.votes);
      g.voters[session] = true;

      var w = voteWinner(v);
      var l = voteLoser(v);
      var pair = votePair(v);
      if (l === undefined && pair && w !== undefined) {
        l = (String(pair[0]) === String(w)) ? pair[1] : pair[0];
      }
      function bump(id, key) {
        if (id === undefined) return;
        var k = String(id);
        if (!g.cardStats[k]) g.cardStats[k] = { wins: 0, appearances: 0 };
        g.cardStats[k][key]++;
        if (key === 'wins') g.cardStats[k].appearances++;
      }
      bump(w, 'wins');
      // count loser appearance
      if (l !== undefined) {
        var lk = String(l);
        if (!g.cardStats[lk]) g.cardStats[lk] = { wins: 0, appearances: 0 };
        g.cardStats[lk].appearances++;
      }
    });

    var departments = [];
    var suppressed = [];

    Object.keys(groups).forEach(function (dept) {
      var g = groups[dept];
      var voterCount = Object.keys(g.voters).length;
      // Build ranked card list for this department.
      var cards = Object.keys(g.cardStats).map(function (id) {
        var cs = g.cardStats[id];
        return {
          cardId: id,
          card: index[id] || { label: id },
          wins: cs.wins,
          appearances: cs.appearances,
          winRate: cs.appearances ? cs.wins / cs.appearances : 0
        };
      }).sort(function (a, b) {
        if (b.winRate !== a.winRate) return b.winRate - a.winRate;
        return b.wins - a.wins;
      });

      var entry = {
        dept: dept,
        votes: g.votes,
        voters: voterCount,
        top: cards.slice(0, 3),
        suppressed: voterCount < threshold
      };

      if (entry.suppressed) suppressed.push(entry);
      else departments.push(entry);
    });

    departments.sort(function (a, b) { return b.votes - a.votes; });
    suppressed.sort(function (a, b) { return b.votes - a.votes; });

    return { departments: departments, suppressed: suppressed, threshold: threshold };
  }

  function totals(round) {
    round = round || getRound();
    return {
      cards: (round && round.cards ? round.cards.length : 0),
      signals: (round && round.signals ? round.signals.length : 0),
      votes: (round && round.votes ? round.votes.length : 0)
    };
  }

  // Turn an ISO/date value into e.g. "June 22, 2026"; '' for missing/invalid.
  function formatBriefDate(value) {
    if (!value) return '';
    var d = new Date(value);
    if (isNaN(d.getTime())) return '';
    try {
      return d.toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric'
      });
    } catch (e) {
      return '';
    }
  }

  function isSampleRound(round) {
    if (!round) return false;
    return !!(round.isSample || round.sample || round.demo ||
      (round.id && /sample|demo|example/i.test(String(round.id))));
  }

  /* ------------------------------------------------------------------ *
   * Rendering — shared card bits
   * ------------------------------------------------------------------ */

  function thumbHtml(card, cls) {
    var thumb = cardThumb(card);
    var label = cardLabel(card);
    if (thumb) {
      return '<img class="' + (cls || 'td-thumb') + '" src="' + esc(thumb) +
        '" alt="' + esc(label) + '" loading="lazy" ' +
        'onerror="this.style.display=&#39;none&#39;;this.nextSibling&amp;&amp;(this.nextSibling.style.display=&#39;flex&#39;);">' +
        '<span class="' + (cls || 'td-thumb') + ' td-thumb-fallback" style="display:none">' +
        esc(initials(label)) + '</span>';
    }
    return '<span class="' + (cls || 'td-thumb') + ' td-thumb-fallback">' +
      esc(initials(label)) + '</span>';
  }

  function initials(label) {
    // Word-initial LETTERS/digits only, so leading quotes/punctuation
    // (e.g. Chunky "claymorphism") never leak into the badge.
    var words = String(label || '')
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

  function sourcesHtml(card) {
    var sources = cardSources(card);
    var signals = cardSignals(card);
    if (!sources.length && signals.length) {
      // Fall back to labeled link chips from raw signals.
      return signals.slice(0, 4).map(function (sig) {
        var label, url;
        if (typeof sig === 'string') { label = sig; url = ''; }
        else {
          label = firstOf(sig, 'theme', 'label', 'title', 'name') || 'signal';
          url = firstOf(sig, 'url', 'source', 'href') || '';
        }
        if (url) {
          return '<a class="td-chip" href="' + esc(url) + '" target="_blank" rel="noopener">' +
            esc(label) + '</a>';
        }
        return '<span class="td-chip">' + esc(label) + '</span>';
      }).join('');
    }
    return sources.map(function (s) {
      return '<span class="td-chip">' + esc(s.label) +
        (s.count > 1 ? ' <b>' + s.count + '</b>' : '') + '</span>';
    }).join('');
  }

  /* ------------------------------------------------------------------ *
   * Rendering — Dashboard view
   * ------------------------------------------------------------------ */

  function resolveMount(container) {
    if (container && container.nodeType === 1) return container;
    var candidates = [
      '[data-view-mount]', '#view', '#app-view', '#main-view',
      '#dashboard-view', '#content', 'main', '#app'
    ];
    for (var i = 0; i < candidates.length; i++) {
      var el = document.querySelector(candidates[i]);
      if (el) return el;
    }
    return document.body;
  }

  function render(container) {
    var mount = resolveMount(container);
    var round = getRound();

    if (!round || !(round.cards && round.cards.length)) {
      mount.innerHTML =
        '<section class="td-dashboard td-empty">' +
        '<h2>Consensus dashboard</h2>' +
        '<p class="td-muted">No trend cards yet. Add signals, group them into ' +
        'trend cards, and collect votes to populate the dashboard.</p>' +
        '</section>';
      return;
    }

    var leaderboard = computeLeaderboard(round);
    var deptData = computeDepartments(round);
    var t = totals(round);
    var settings = getSettings(round);
    var sampleBadge = isSampleRound(round)
      ? '<span class="td-badge td-badge-sample">Example data</span>' : '';

    var html = '';
    html += '<section class="td-dashboard">';
    html += '<header class="td-dash-head">';
    html += '<div><h2>Consensus dashboard ' + sampleBadge + '</h2>';
    html += '<p class="td-muted">' + t.cards + ' trend cards · ' + t.signals +
      ' signals · ' + t.votes + ' votes' +
      (settings.roundClosed ? ' · <strong>round closed</strong>' : '') + '</p></div>';
    html += '<div class="td-dash-actions">';
    html += '<button type="button" class="td-btn td-btn-primary" id="td-export-brief">Export Trend Brief</button>';
    html += '<button type="button" class="td-btn" id="td-export-pdf">Download PDF</button>';
    html += '</div></header>';

    if (t.votes === 0) {
      html += '<p class="td-notice">No votes recorded yet — the leaderboard below ' +
        'shows every card at a 0% win rate until the studio votes.</p>';
    }

    /* ---- Leaderboard ---- */
    html += '<h3 class="td-section-title">Win-rate leaderboard</h3>';
    html += '<ol class="td-leaderboard">';
    leaderboard.forEach(function (row) {
      var card = row.card;
      var score = cardScore(card);
      html += '<li class="td-lb-row">';
      html += '<span class="td-rank">' + row.rank + '</span>';
      html += thumbHtml(card, 'td-thumb');
      html += '<div class="td-lb-body">';
      html += '<div class="td-lb-head"><span class="td-lb-label">' +
        esc(cardLabel(card)) + '</span>';
      html += '<span class="td-winrate">' + pct(row.winRate) + '%</span></div>';
      html += '<div class="td-bar"><span class="td-bar-fill" style="width:' +
        pct(row.winRate) + '%"></span></div>';
      html += '<div class="td-lb-meta">' +
        '<span title="Head-to-head wins">' + row.wins + ' wins</span>' +
        '<span title="Times shown in a pair">' + row.appearances + ' appearances</span>' +
        (score !== null && isFinite(score) ? '<span title="Composite score">score ' +
          (Math.round(score * 10) / 10) + '</span>' : '') +
        '</div>';
      var rationale = cardRationale(card);
      if (rationale) {
        html += '<p class="td-rationale">' + esc(rationale) + '</p>';
      }
      var chips = sourcesHtml(card);
      if (chips) html += '<div class="td-chips">' + chips + '</div>';
      html += '</div></li>';
    });
    html += '</ol>';

    /* ---- Department breakdown ---- */
    html += '<h3 class="td-section-title">By department ' +
      '<span class="td-muted td-small">(small departments under ' +
      deptData.threshold + ' voters are suppressed)</span></h3>';

    if (!deptData.departments.length && !deptData.suppressed.length) {
      html += '<p class="td-muted">No department data yet.</p>';
    } else {
      html += '<div class="td-dept-grid">';
      deptData.departments.forEach(function (d) {
        html += '<div class="td-dept-card">';
        html += '<div class="td-dept-head"><strong>' + esc(d.dept) + '</strong>' +
          '<span class="td-muted">' + d.voters + ' voters · ' + d.votes + ' votes</span></div>';
        html += '<ol class="td-dept-list">';
        d.top.forEach(function (c) {
          html += '<li><span class="td-dept-cardlabel">' + esc(cardLabel(c.card)) +
            '</span><span class="td-dept-rate">' + pct(c.winRate) + '%</span></li>';
        });
        html += '</ol></div>';
      });
      html += '</div>';

      if (deptData.suppressed.length) {
        html += '<p class="td-muted td-small td-suppressed">Suppressed for small ' +
          'sample size: ' +
          deptData.suppressed.map(function (d) {
            return esc(d.dept) + ' (' + d.voters + ')';
          }).join(', ') + '.</p>';
      }
    }

    html += '</section>';

    mount.innerHTML = html;
    wireDashboard(mount);
  }

  function wireDashboard(mount) {
    var exportBtn = mount.querySelector('#td-export-brief');
    if (exportBtn) exportBtn.addEventListener('click', function () { exportBrief(); });
    var pdfBtn = mount.querySelector('#td-export-pdf');
    if (pdfBtn) pdfBtn.addEventListener('click', function () { exportPDF(); });
  }

  /* ------------------------------------------------------------------ *
   * Rendering — Two-page Trend Brief
   * ------------------------------------------------------------------ */

  function buildBriefHtml(round) {
    round = round || getRound();
    var leaderboard = computeLeaderboard(round);
    var deptData = computeDepartments(round);
    var t = totals(round);
    var settings = getSettings(round);
    var roundName = firstOf(round, 'name', 'title', 'label') || 'Studio Trend Round';
    var dateStr = formatBriefDate(firstOf(round, 'date', 'createdAt', 'created'));
    var winners = leaderboard.slice(0, 5);

    var html = '<div class="td-brief" id="td-brief">';

    /* ---------------- Page 1: Top Trends ---------------- */
    html += '<article class="brief-page brief-page-1">';
    html += '<header class="brief-header">';
    html += '<div><div class="brief-kicker">Trend Brief</div>';
    html += '<h1 class="brief-title">' + esc(roundName) + '</h1></div>';
    html += '<div class="brief-meta">' +
      (dateStr ? esc(dateStr) + '<br>' : '') +
      t.votes + ' votes · ' + t.cards + ' trends · ' + t.signals + ' signals' +
      (isSampleRound(round) ? '<br><em>Example data</em>' : '') +
      '</div>';
    html += '</header>';

    if (t.votes < LOW_CONFIDENCE_VOTES) {
      var voteWord = t.votes === 1 ? 'vote' : 'votes';
      html += '<div class="brief-lowconf" role="note"><strong>Low-confidence ' +
        'draft.</strong> This brief is based on ' + t.votes + ' ' + voteWord +
        '. Treat the ranking as directional until more of the studio has voted.</div>';
    }

    html += '<h2 class="brief-h2">Top trends by consensus</h2>';
    html += '<div class="brief-winners">';
    winners.forEach(function (row) {
      var card = row.card;
      html += '<div class="brief-winner">';
      html += '<div class="brief-winner-rank">' + row.rank + '</div>';
      html += thumbHtml(card, 'brief-thumb');
      html += '<div class="brief-winner-body">';
      html += '<div class="brief-winner-head"><span class="brief-winner-label">' +
        esc(cardLabel(card)) + '</span><span class="brief-winner-rate">' +
        pct(row.winRate) + '%</span></div>';
      html += '<div class="brief-bar"><span style="width:' + pct(row.winRate) + '%"></span></div>';
      html += '<div class="brief-winner-meta">' + row.wins + ' wins · ' +
        row.appearances + ' appearances</div>';
      var rationale = cardRationale(card);
      if (rationale) html += '<p class="brief-rationale">' + esc(rationale) + '</p>';
      html += '</div></div>';
    });
    html += '</div>';
    html += '<footer class="brief-footer">TrendDeck · Page 1 of 2</footer>';
    html += '</article>';

    /* ---------------- Page 2: Full ranking + departments ---------------- */
    html += '<article class="brief-page brief-page-2">';
    html += '<header class="brief-header brief-header-slim">';
    html += '<div class="brief-kicker">' + esc(roundName) + '</div>';
    html += '<div class="brief-meta">Full ranking &amp; department signal</div>';
    html += '</header>';

    html += '<h2 class="brief-h2">Full leaderboard</h2>';
    html += '<table class="brief-table"><thead><tr>' +
      '<th>#</th><th>Trend</th><th>Win rate</th><th>Wins</th><th>Appears</th>' +
      '</tr></thead><tbody>';
    leaderboard.forEach(function (row) {
      html += '<tr><td>' + row.rank + '</td><td>' + esc(cardLabel(row.card)) +
        '</td><td>' + pct(row.winRate) + '%</td><td>' + row.wins + '</td><td>' +
        row.appearances + '</td></tr>';
    });
    html += '</tbody></table>';

    html += '<h2 class="brief-h2">Department signal</h2>';
    if (deptData.departments.length) {
      html += '<div class="brief-dept-grid">';
      deptData.departments.forEach(function (d) {
        html += '<div class="brief-dept"><div class="brief-dept-head">' +
          esc(d.dept) + ' <span>(' + d.voters + ' voters)</span></div>';
        html += '<ul>';
        d.top.forEach(function (c) {
          html += '<li>' + esc(cardLabel(c.card)) + ' — ' + pct(c.winRate) + '%</li>';
        });
        html += '</ul></div>';
      });
      html += '</div>';
    } else {
      html += '<p class="brief-muted">No departments above the suppression threshold.</p>';
    }
    if (deptData.suppressed.length) {
      html += '<p class="brief-muted">Suppressed (under ' + deptData.threshold +
        ' voters): ' + deptData.suppressed.map(function (d) {
          return esc(d.dept);
        }).join(', ') + '.</p>';
    }

    html += '<h2 class="brief-h2">Method</h2>';
    html += '<p class="brief-method">Anonymous studio voters each judged 6–10 ' +
      'random head-to-head pairs of trend cards. Win rate is wins ÷ appearances. ' +
      'Department breakdowns suppress groups with fewer than ' + deptData.threshold +
      ' voters to protect anonymity and avoid over-reading tiny samples.</p>';
    html += '<footer class="brief-footer">TrendDeck · Page 2 of 2</footer>';
    html += '</article>';

    html += '</div>';
    return html;
  }

  function renderBrief(container) {
    var mount = resolveMount(container);
    var round = getRound();
    if (!round || !(round.cards && round.cards.length)) {
      mount.innerHTML = '<section class="td-empty"><h2>Trend Brief</h2>' +
        '<p class="td-muted">Nothing to brief yet — create trend cards and ' +
        'collect votes first.</p></section>';
      return;
    }
    var html = '<section class="td-brief-view">';
    html += '<div class="td-brief-toolbar td-no-print">';
    html += '<button type="button" class="td-btn td-btn-primary" id="td-brief-print">Print / Save as PDF</button>';
    html += '<button type="button" class="td-btn" id="td-brief-pdf">Download PDF (jsPDF)</button>';
    html += '</div>';
    html += buildBriefHtml(round);
    html += '</section>';
    mount.innerHTML = html;

    var printBtn = mount.querySelector('#td-brief-print');
    if (printBtn) printBtn.addEventListener('click', function () {
      document.body.classList.add('is-printing');
      window.print();
    });
    var pdfBtn = mount.querySelector('#td-brief-pdf');
    if (pdfBtn) pdfBtn.addEventListener('click', function () { exportPDF(); });
  }

  /* ------------------------------------------------------------------ *
   * Export actions
   * ------------------------------------------------------------------ */

  // Build (or refresh) a hidden print-only brief and trigger window.print().
  function exportBrief() {
    var round = getRound();
    if (!round || !(round.cards && round.cards.length)) {
      alert('There is nothing to export yet — create trend cards and collect votes first.');
      return;
    }

    // Remove any stale print container, then inject a fresh one.
    var existing = document.getElementById('td-print-root');
    if (existing) existing.parentNode.removeChild(existing);

    var root = document.createElement('div');
    root.id = 'td-print-root';
    root.className = 'td-print-root';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = buildBriefHtml(round);
    document.body.appendChild(root);

    // Defer to next frame so images/layout settle before printing.
    var fire = function () {
      document.body.classList.add('is-printing');
      window.print();
    };
    if (global.requestAnimationFrame) {
      global.requestAnimationFrame(function () {
        global.requestAnimationFrame(fire);
      });
    } else {
      setTimeout(fire, 60);
    }
  }

  // Optional jsPDF text-based export. Degrades gracefully when jsPDF is absent.
  function exportPDF() {
    var jsPDFCtor = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF ||
      (global.jspdf && global.jspdf.default);
    if (!jsPDFCtor) {
      // No jsPDF on the page — fall back to the print dialog.
      if (confirm('PDF library (jsPDF) is not loaded. Use the browser print ' +
        'dialog to "Save as PDF" instead?')) {
        exportBrief();
      }
      return;
    }

    var round = getRound();
    if (!round || !(round.cards && round.cards.length)) {
      alert('Nothing to export yet.');
      return;
    }

    try {
      var doc = new jsPDFCtor({ unit: 'pt', format: 'a4' });
      var leaderboard = computeLeaderboard(round);
      var deptData = computeDepartments(round);
      var t = totals(round);
      var roundName = firstOf(round, 'name', 'title', 'label') || 'Studio Trend Round';
      var margin = 48;
      var width = doc.internal.pageSize.getWidth();
      var y = margin;

      function line(text, size, bold, gap) {
        doc.setFontSize(size || 11);
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        var lines = doc.splitTextToSize(String(text), width - margin * 2);
        for (var i = 0; i < lines.length; i++) {
          if (y > doc.internal.pageSize.getHeight() - margin) {
            doc.addPage();
            y = margin;
          }
          doc.text(lines[i], margin, y);
          y += (size || 11) + 4;
        }
        y += (gap || 0);
      }

      line('Trend Brief', 22, true, 4);
      line(roundName, 14, true, 2);
      line(t.votes + ' votes · ' + t.cards + ' trends · ' + t.signals + ' signals' +
        (isSampleRound(round) ? '   (example data)' : ''), 10, false, 12);

      line('Win-rate leaderboard', 14, true, 6);
      leaderboard.forEach(function (row) {
        line(row.rank + '.  ' + cardLabel(row.card) + '   —   ' + pct(row.winRate) +
          '%  (' + row.wins + ' wins / ' + row.appearances + ' appearances)', 11, false, 0);
        var rationale = cardRationale(row.card);
        if (rationale) line('     ' + rationale, 9, false, 2);
      });
      y += 8;

      line('Department signal', 14, true, 6);
      if (deptData.departments.length) {
        deptData.departments.forEach(function (d) {
          line(d.dept + '  (' + d.voters + ' voters):', 11, true, 0);
          d.top.forEach(function (c) {
            line('     ' + cardLabel(c.card) + ' — ' + pct(c.winRate) + '%', 10, false, 0);
          });
        });
      } else {
        line('No departments above the suppression threshold of ' +
          deptData.threshold + ' voters.', 10, false, 0);
      }
      if (deptData.suppressed.length) {
        line('Suppressed (small sample): ' + deptData.suppressed.map(function (d) {
          return d.dept;
        }).join(', '), 9, false, 0);
      }

      var safeName = String(roundName).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      doc.save('trend-brief-' + (safeName || 'round') + '.pdf');
    } catch (err) {
      console.error('jsPDF export failed:', err);
      if (confirm('PDF export failed. Use the browser print dialog instead?')) {
        exportBrief();
      }
    }
  }

  // Clean up the injected print root after printing so it never shows on screen.
  global.addEventListener('afterprint', function () {
    document.body.classList.remove('is-printing');
    var root = document.getElementById('td-print-root');
    if (root && root.parentNode) root.parentNode.removeChild(root);
  });

  /* ------------------------------------------------------------------ *
   * Optional self-wiring for hash routes (#dashboard / #brief)
   * ------------------------------------------------------------------ */

  function maybeRouteRender() {
    // When index.html's hash router is present it drives rendering through the
    // `trenddeck:render` event into dedicated containers; staying passive here
    // avoids clobbering <main> (this fallback's generic mount target).
    if (global.TrendDeck && typeof global.TrendDeck.refresh === 'function') return;
    var hash = (global.location.hash || '').replace(/^#\/?/, '').toLowerCase();
    if (hash === 'dashboard' || hash === 'consensus' || hash === 'results') {
      render();
    } else if (hash === 'brief') {
      renderBrief();
    }
  }

  // Only auto-wire if no external router has claimed rendering. We listen for
  // hashchange but stay passive on direct calls from index.html's router.
  global.addEventListener('hashchange', maybeRouteRender);

  // index.html's hash router fires `trenddeck:render` with detail.route when a
  // view becomes active. Render the Dashboard into #dashboard-root and the
  // Trend Brief into #brief-root so both paint on the initial route and on nav
  // changes (the hashchange fallback above mounts to generic containers that do
  // not exist in this shell).
  global.document.addEventListener('trenddeck:render', function (ev) {
    var route = String((ev && ev.detail && ev.detail.route) || '').toLowerCase();
    if (route === 'dashboard' || route === 'consensus' || route === 'results') {
      var dRoot = document.getElementById('dashboard-root');
      if (dRoot) render(dRoot);
    } else if (route === 'brief') {
      var bRoot = document.getElementById('brief-root');
      if (bRoot) renderBrief(bRoot);
    }
  });

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */

  global.Dashboard = {
    render: render,
    renderDashboard: render,
    renderBrief: renderBrief,
    buildBriefHtml: buildBriefHtml,
    exportBrief: exportBrief,
    exportPDF: exportPDF,
    computeLeaderboard: computeLeaderboard,
    computeDepartments: computeDepartments,
    _route: maybeRouteRender
  };

})(window);
