/*
 * TrendDeck — js/cards.js
 * ---------------------------------------------------------------------------
 * Manual trend-card creation / grouping UI + an optional "paste Claude
 * clustering JSON" importer.
 *
 * Responsibilities
 *   - Read raw signals + saved cards from the persistence layer (js/store.js).
 *   - Let an admin group ungrouped signals into named trend cards, edit a
 *     card's label / rationale, add or remove member signals, and delete cards.
 *   - Accept a pasted Claude clustering JSON blob, validate it against the card
 *     schema, resolve its signal references, and import it (target card count =
 *     clamp(min(25, ceil(signals/2)), 3, 25)).
 *   - Render the reviewable card gallery: label, rationale, source-platform
 *     breakdown, composite score, and thumbnail previews that gracefully fall
 *     back to labeled link chips.
 *
 * This module is defensive about the store API (it probes for several common
 * method names and falls back to round-embedded cards or localStorage) so it
 * stays self-consistent even though store.js is authored separately.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  /* ----------------------------------------------------------------------- *
   * Small utilities
   * ----------------------------------------------------------------------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[c];
    });
  }

  function clamp(x, lo, hi) {
    x = Number(x);
    if (!isFinite(x)) x = lo;
    return Math.max(lo, Math.min(hi, x));
  }

  function numOr(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  function truncate(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n - 1) + '\u2026' : s;
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' +
      Math.floor(Math.random() * 1e6).toString(36);
  }

  function hostOf(url) {
    try {
      var h = new URL(url).hostname.toLowerCase();
      return h.indexOf('www.') === 0 ? h.slice(4) : h;
    } catch (e) {
      return '';
    }
  }

  function platformFromUrl(url) {
    var h = hostOf(url);
    if (!h) return '';
    if (h.indexOf('tiktok') !== -1) return 'TikTok';
    if (h.indexOf('instagram') !== -1) return 'Instagram';
    if (h.indexOf('youtu') !== -1) return 'YouTube';
    if (h.indexOf('pinterest') !== -1 || h.indexOf('pin.it') !== -1) return 'Pinterest';
    if (h.indexOf('twitter') !== -1 || h === 'x.com' || h.indexOf('.x.com') !== -1) return 'X';
    if (h.indexOf('behance') !== -1) return 'Behance';
    if (h.indexOf('dribbble') !== -1) return 'Dribbble';
    if (h.indexOf('reddit') !== -1) return 'Reddit';
    if (h.indexOf('tumblr') !== -1) return 'Tumblr';
    if (h.indexOf('vimeo') !== -1) return 'Vimeo';
    if (h.indexOf('substack') !== -1) return 'Substack';
    if (h.indexOf('threads') !== -1) return 'Threads';
    return 'Web';
  }

  function normPlatform(p) {
    if (!p) return 'Web';
    var key = String(p).trim().toLowerCase();
    var map = {
      tiktok: 'TikTok', instagram: 'Instagram', ig: 'Instagram',
      youtube: 'YouTube', yt: 'YouTube', pinterest: 'Pinterest',
      twitter: 'X', x: 'X', behance: 'Behance', dribbble: 'Dribbble',
      reddit: 'Reddit', tumblr: 'Tumblr', vimeo: 'Vimeo', web: 'Web',
      threads: 'Threads', substack: 'Substack', linkedin: 'LinkedIn'
    };
    if (map[key]) return map[key];
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  var PLATFORM_COLORS = {
    TikTok: '#000000', Instagram: '#c13584', YouTube: '#ff0000',
    Pinterest: '#e60023', X: '#1d9bf0', Behance: '#1769ff',
    Dribbble: '#ea4c89', Reddit: '#ff4500', Tumblr: '#36465d',
    Vimeo: '#1ab7ea', Web: '#6b7280', Threads: '#101010',
    Substack: '#ff6719', LinkedIn: '#0a66c2'
  };

  function platformColor(p) {
    return PLATFORM_COLORS[p] || '#6b7280';
  }

  /* ----------------------------------------------------------------------- *
   * Store adapter (defensive: probes for common method / property names)
   * ----------------------------------------------------------------------- */

  function S() {
    return window.Store || window.TrendDeckStore || window.store || {};
  }

  function tryCall(names, args) {
    var s = S();
    for (var i = 0; i < names.length; i++) {
      var fn = s[names[i]];
      if (typeof fn === 'function') {
        try {
          return { ok: true, value: fn.apply(s, args || []) };
        } catch (e) {
          console.warn('[cards] Store.' + names[i] + ' threw', e);
        }
      }
    }
    return { ok: false, value: undefined };
  }

  function getRound() {
    var r = tryCall(['getActiveRound', 'getCurrentRound', 'getRound', 'activeRound']);
    if (r.ok && r.value) return r.value;
    var s = S();
    if (s.round && typeof s.round === 'object') return s.round;
    if (s.activeRound && typeof s.activeRound === 'object') return s.activeRound;
    return null;
  }

  function rawSignals() {
    var r = tryCall(['getSignals', 'listSignals', 'getRoundSignals']);
    if (r.ok && Array.isArray(r.value)) return r.value;
    var s = S();
    if (Array.isArray(s.signals)) return s.signals;
    var round = getRound();
    if (round && Array.isArray(round.signals)) return round.signals;
    return [];
  }

  function rawCards() {
    var r = tryCall(['getCards', 'listCards', 'getTrendCards']);
    if (r.ok && Array.isArray(r.value)) return r.value;
    var s = S();
    if (Array.isArray(s.cards)) return s.cards;
    var round = getRound();
    if (round && Array.isArray(round.cards)) return round.cards;
    return [];
  }

  // store.setCards(roundId, cards) is roundId-first; pass null to mean
  // "active round". It is the single source of truth — no divergent
  // localStorage fallback so a failed write is visible (an empty gallery)
  // rather than masked by a key nothing else reads.
  function persistCards(cards) {
    var s = S();
    if (s && typeof s.setCards === 'function') {
      s.setCards(null, cards);
      announceChanged();
      return;
    }
    // No store available — do not write anywhere; just re-render against
    // whatever the store reports (the honest state when there is no store).
    announceChanged();
  }

  function announceChanged() {
    try {
      document.dispatchEvent(new CustomEvent('trenddeck:cards-changed'));
    } catch (e) { /* old browsers */ }
  }

  function roundIsSample() {
    var round = getRound();
    if (!round) return false;
    return !!(round.sample || round.isSample || round.example || round.demo);
  }

  /* ----------------------------------------------------------------------- *
   * Normalization
   * ----------------------------------------------------------------------- */

  function normSignal(s, i) {
    s = s || {};
    var url = s.url || s.sourceUrl || s.source_url || s.link || s.href || '';
    var thumb = s.thumbnail || s.thumbnailUrl || s.thumbnail_url ||
      s.image || s.imageUrl || s.img || '';
    var platform = normPlatform(s.platform || s.source || platformFromUrl(url));
    return {
      id: s.id || s.signalId || s.signal_id || ('sig_' + i),
      label: s.label || s.theme || s.title || s.name || 'Untitled signal',
      url: url,
      thumbnail: thumb,
      platform: platform,
      score: numOr(s.score != null ? s.score : (s.engagement != null ? s.engagement : null), null),
      note: s.note || s.notes || s.rationale || ''
    };
  }

  function getSignals() {
    return rawSignals().map(normSignal);
  }

  function signalIndex(signals) {
    var byId = {};
    var byUrl = {};
    var byLabel = {};
    signals.forEach(function (s) {
      byId[s.id] = s;
      if (s.url) byUrl[s.url.toLowerCase()] = s;
      if (s.label) byLabel[s.label.toLowerCase()] = s;
    });
    return { byId: byId, byUrl: byUrl, byLabel: byLabel };
  }

  function normCard(c, i) {
    c = c || {};
    var ids = c.signalIds || c.signal_ids || c.signals || c.members ||
      c.memberIds || c.member_ids || [];
    if (!Array.isArray(ids)) ids = [];
    return {
      id: c.id || c.cardId || ('card_' + i),
      label: c.label || c.name || c.title || 'Untitled trend',
      rationale: c.rationale || c.reason || c.why || c.description || '',
      signalIds: ids.slice(),
      score: numOr(c.score != null ? c.score : (c.composite != null ? c.composite : null), null),
      createdAt: c.createdAt || c.created_at || null,
      imported: !!c.imported
    };
  }

  function getCards() {
    return rawCards().map(normCard);
  }

  /* ----------------------------------------------------------------------- *
   * Card analytics
   * ----------------------------------------------------------------------- */

  function membersOf(card, byId) {
    var out = [];
    (card.signalIds || []).forEach(function (id) {
      if (byId[id]) out.push(byId[id]);
    });
    return out;
  }

  function platformBreakdown(members) {
    var counts = {};
    members.forEach(function (m) {
      counts[m.platform] = (counts[m.platform] || 0) + 1;
    });
    return Object.keys(counts).map(function (p) {
      return { platform: p, count: counts[p] };
    }).sort(function (a, b) { return b.count - a.count; });
  }

  // Composite score in 0..100. Prefers an explicitly-provided card score
  // (e.g. from a Claude import); otherwise derives one from member signal
  // strength, platform diversity and cluster volume.
  function compositeScore(card, members) {
    if (typeof card.score === 'number' && isFinite(card.score)) {
      return Math.round(clamp(card.score, 0, 100));
    }
    if (!members.length) return 0;
    var scored = members.filter(function (m) { return typeof m.score === 'number'; });
    var diversity = Math.min(new Set(members.map(function (m) { return m.platform; })).size, 5) / 5;
    var volume = Math.min(members.length, 8) / 8;
    var composite;
    if (scored.length) {
      var avg = scored.reduce(function (a, m) { return a + m.score; }, 0) / scored.length;
      // Normalize avg if it looks like a 0..1 or 0..10 scale.
      if (avg <= 1) avg *= 100; else if (avg <= 10) avg *= 10;
      composite = 0.60 * avg + 0.25 * diversity * 100 + 0.15 * volume * 100;
    } else {
      composite = 50 + 30 * volume + 20 * diversity;
    }
    return Math.round(clamp(composite, 0, 100));
  }

  function scoreClass(score) {
    if (score >= 75) return 'score-high';
    if (score >= 50) return 'score-mid';
    return 'score-low';
  }

  function targetCardCount(signalCount) {
    // clamp(min(25, ceil(signals/2)), 3, 25)
    return clamp(Math.min(25, Math.ceil(signalCount / 2)), 3, 25);
  }

  function groupedIdSet(cards) {
    var set = {};
    cards.forEach(function (c) {
      (c.signalIds || []).forEach(function (id) { set[id] = true; });
    });
    return set;
  }

  /* ----------------------------------------------------------------------- *
   * Module UI state (selection + importer panel)
   * ----------------------------------------------------------------------- */

  var ui = {
    selection: {},       // signalId -> true (checked ungrouped signals)
    showImporter: false,
    replaceOnImport: true,
    importMessage: null  // { kind: 'ok'|'warn'|'error', text, details }
  };

  var currentContainer = null;

  /* ----------------------------------------------------------------------- *
   * Clustering-JSON importer
   * ----------------------------------------------------------------------- */

  function resolveRef(ref, signals, idx) {
    if (ref == null) return null;
    if (typeof ref === 'number') {
      return signals[ref] ? signals[ref].id : null;
    }
    if (typeof ref === 'object') {
      ref = ref.id || ref.signalId || ref.url || ref.label || '';
    }
    var key = String(ref).trim();
    if (!key) return null;
    if (idx.byId[key]) return idx.byId[key].id;
    var low = key.toLowerCase();
    if (idx.byUrl[low]) return idx.byUrl[low].id;
    if (idx.byLabel[low]) return idx.byLabel[low].id;
    // Numeric-as-string index.
    if (/^\d+$/.test(key) && signals[Number(key)]) return signals[Number(key)].id;
    return null;
  }

  function parseClusteringJSON(text, signals) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: 'Invalid JSON: ' + e.message };
    }
    var list = null;
    if (Array.isArray(data)) list = data;
    else if (data && Array.isArray(data.cards)) list = data.cards;
    else if (data && Array.isArray(data.clusters)) list = data.clusters;
    else if (data && Array.isArray(data.trend_cards)) list = data.trend_cards;
    if (!list) {
      return { ok: false, error: 'Expected an array of cards, or an object with a "cards" array.' };
    }
    if (!list.length) {
      return { ok: false, error: 'The clustering JSON contained zero cards.' };
    }

    var idx = signalIndex(signals);
    var cards = [];
    var warnings = [];
    var unresolved = 0;

    list.forEach(function (raw, i) {
      raw = raw || {};
      var label = raw.label || raw.name || raw.title;
      if (!label || typeof label !== 'string') {
        warnings.push('Card #' + (i + 1) + ' is missing a text "label" \u2014 skipped.');
        return;
      }
      var refs = raw.signalIds || raw.signal_ids || raw.signals ||
        raw.members || raw.memberIds || raw.member_ids || raw.signal_indices || [];
      if (!Array.isArray(refs)) refs = [];
      var ids = [];
      refs.forEach(function (r) {
        var id = resolveRef(r, signals, idx);
        if (id && ids.indexOf(id) === -1) ids.push(id);
        else if (!id) unresolved++;
      });
      cards.push({
        id: uid('card'),
        label: String(label),
        rationale: String(raw.rationale || raw.reason || raw.why || raw.description || ''),
        signalIds: ids,
        score: numOr(raw.score != null ? raw.score : (raw.composite != null ? raw.composite : null), null),
        createdAt: new Date().toISOString(),
        imported: true
      });
    });

    if (!cards.length) {
      return { ok: false, error: 'No valid cards found (every entry was missing a label).', warnings: warnings };
    }
    if (unresolved) {
      warnings.push(unresolved + ' signal reference(s) did not match any imported signal and were dropped.');
    }

    var target = targetCardCount(signals.length);
    if (cards.length < 3 || cards.length > 25) {
      warnings.push('Card count ' + cards.length + ' is outside the supported 3\u201325 range.');
    } else if (Math.abs(cards.length - target) > Math.max(2, Math.round(target * 0.4))) {
      warnings.push('Card count ' + cards.length + ' differs from the suggested target of ~' +
        target + ' for ' + signals.length + ' signals.');
    }

    return { ok: true, cards: cards, warnings: warnings, target: target };
  }

  function doImport() {
    var ta = currentContainer.querySelector('#clusterJsonInput');
    if (!ta) return;
    var signals = getSignals();
    var result = parseClusteringJSON(ta.value || '', signals);
    if (!result.ok) {
      ui.importMessage = { kind: 'error', text: result.error, details: result.warnings || [] };
      render();
      return;
    }
    var existing = ui.replaceOnImport ? [] : getCards().map(toStoredCard);
    var merged = existing.concat(result.cards);
    persistCards(merged);
    ui.importMessage = {
      kind: result.warnings.length ? 'warn' : 'ok',
      text: 'Imported ' + result.cards.length + ' card(s)' +
        (ui.replaceOnImport ? ' (replaced existing).' : ' (appended).') +
        ' Target for ' + signals.length + ' signals was ~' + result.target + '.',
      details: result.warnings
    };
    ui.showImporter = false;
    render();
  }

  function toStoredCard(card) {
    return {
      id: card.id,
      label: card.label,
      rationale: card.rationale,
      signalIds: card.signalIds,
      score: card.score,
      createdAt: card.createdAt,
      imported: card.imported
    };
  }

  /* ----------------------------------------------------------------------- *
   * Mutations
   * ----------------------------------------------------------------------- */

  function selectedSignalIds() {
    return Object.keys(ui.selection).filter(function (id) { return ui.selection[id]; });
  }

  function createCardFromSelection() {
    var ids = selectedSignalIds();
    var cards = getCards().map(toStoredCard);
    cards.push({
      id: uid('card'),
      label: 'New trend ' + (cards.length + 1),
      rationale: '',
      signalIds: ids,
      score: null,
      createdAt: new Date().toISOString(),
      imported: false
    });
    ui.selection = {};
    persistCards(cards);
    render();
  }

  function deleteCard(id) {
    var cards = getCards().map(toStoredCard).filter(function (c) { return c.id !== id; });
    persistCards(cards);
    render();
  }

  function clearAllCards() {
    if (!window.confirm('Delete ALL trend cards? Signals are kept; only the groupings are removed.')) return;
    persistCards([]);
    render();
  }

  function updateCardField(id, field, value) {
    var cards = getCards().map(toStoredCard);
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].id === id) {
        cards[i][field] = value;
        break;
      }
    }
    persistCards(cards);
    // No full re-render here so the editing input keeps focus; the score badge
    // updates on the next render (add/remove member, reload, etc.).
  }

  function addSelectedToCard(id) {
    var ids = selectedSignalIds();
    if (!ids.length) return;
    var cards = getCards().map(toStoredCard);
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].id === id) {
        ids.forEach(function (sid) {
          if (cards[i].signalIds.indexOf(sid) === -1) cards[i].signalIds.push(sid);
        });
        break;
      }
    }
    ui.selection = {};
    persistCards(cards);
    render();
  }

  function removeMember(cardId, signalId) {
    var cards = getCards().map(toStoredCard);
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].id === cardId) {
        cards[i].signalIds = cards[i].signalIds.filter(function (s) { return s !== signalId; });
        break;
      }
    }
    persistCards(cards);
    render();
  }

  /* ----------------------------------------------------------------------- *
   * Rendering helpers
   * ----------------------------------------------------------------------- */

  function linkChipHTML(signal) {
    var label = esc(signal.platform);
    var sub = esc(truncate(signal.label || hostOf(signal.url) || 'signal', 28));
    var color = platformColor(signal.platform);
    var inner =
      '<span class="chip-dot" style="background:' + color + '"></span>' +
      '<span class="chip-text"><strong>' + label + '</strong><em>' + sub + '</em></span>';
    if (signal.url) {
      return '<a class="link-chip" href="' + esc(signal.url) + '" target="_blank" rel="noopener" ' +
        'title="' + esc(signal.label) + '">' + inner + '</a>';
    }
    return '<span class="link-chip" title="' + esc(signal.label) + '">' + inner + '</span>';
  }

  function thumbHTML(signal) {
    // An <img> with a data-fallback marker; wireImages() swaps it for a link
    // chip if it errors or has no source.
    if (signal.thumbnail) {
      return '<a class="trend-thumb" href="' + esc(signal.url || signal.thumbnail) +
        '" target="_blank" rel="noopener" title="' + esc(signal.label) + '">' +
        '<img class="trend-thumb-img" data-fallback="1" ' +
        'data-platform="' + esc(signal.platform) + '" ' +
        'data-label="' + esc(signal.label) + '" ' +
        'data-url="' + esc(signal.url) + '" ' +
        'loading="lazy" alt="' + esc(signal.label) + '" src="' + esc(signal.thumbnail) + '">' +
        '</a>';
    }
    return linkChipHTML(signal);
  }

  function breakdownHTML(breakdown, total) {
    if (!breakdown.length) return '<span class="muted">no member signals</span>';
    return breakdown.map(function (b) {
      var pct = total ? Math.round((b.count / total) * 100) : 0;
      var color = platformColor(b.platform);
      return '<span class="platform-stat" title="' + esc(b.platform) + ': ' + b.count +
        ' of ' + total + ' (' + pct + '%)">' +
        '<span class="platform-bar"><span class="platform-bar-fill" style="width:' + pct +
        '%;background:' + color + '"></span></span>' +
        '<span class="platform-label"><span class="chip-dot" style="background:' + color +
        '"></span>' + esc(b.platform) + ' <b>' + b.count + '</b></span></span>';
    }).join('');
  }

  function cardHTML(card, byId) {
    var members = membersOf(card, byId);
    var score = compositeScore(card, members);
    var breakdown = platformBreakdown(members);
    var thumbs = members.slice(0, 6).map(thumbHTML).join('');
    var moreCount = members.length - 6;

    var memberChips = members.map(function (m) {
      return '<li class="member-row">' +
        '<span class="member-name" title="' + esc(m.label) + '">' +
        '<span class="chip-dot" style="background:' + platformColor(m.platform) + '"></span>' +
        esc(truncate(m.label, 40)) + '</span>' +
        '<button class="member-remove" type="button" data-action="remove-member" ' +
        'data-card="' + esc(card.id) + '" data-signal="' + esc(m.id) + '" ' +
        'title="Remove from card">\u00d7</button>' +
        '</li>';
    }).join('');

    return '' +
      '<article class="trend-card" data-card="' + esc(card.id) + '">' +
        '<header class="trend-card-head">' +
          '<div class="score-badge ' + scoreClass(score) + '" title="Composite score">' +
            '<span class="score-num">' + score + '</span><span class="score-cap">score</span>' +
          '</div>' +
          '<div class="trend-card-title">' +
            '<input class="card-label-input" type="text" data-action="edit-label" ' +
              'data-card="' + esc(card.id) + '" value="' + esc(card.label) + '" ' +
              'aria-label="Trend label" placeholder="Trend label\u2026">' +
            '<div class="trend-card-meta">' +
              members.length + ' signal' + (members.length === 1 ? '' : 's') +
              (card.imported ? ' \u00b7 <span class="tag tag-import">imported</span>' : '') +
            '</div>' +
          '</div>' +
          '<button class="icon-btn danger" type="button" data-action="delete-card" ' +
            'data-card="' + esc(card.id) + '" title="Delete card">\u{1f5d1}</button>' +
        '</header>' +

        '<div class="thumb-strip">' + (thumbs || '<span class="muted">No previews yet</span>') +
          (moreCount > 0 ? '<span class="thumb-more">+' + moreCount + '</span>' : '') +
        '</div>' +

        '<label class="field-label">Rationale</label>' +
        '<textarea class="card-rationale-input" data-action="edit-rationale" ' +
          'data-card="' + esc(card.id) + '" rows="2" ' +
          'placeholder="Why these signals belong together\u2026">' + esc(card.rationale) + '</textarea>' +

        '<div class="breakdown"><span class="field-label">Source platforms</span>' +
          '<div class="breakdown-bars">' + breakdownHTML(breakdown, members.length) + '</div></div>' +

        '<details class="member-details">' +
          '<summary>Members (' + members.length + ')</summary>' +
          '<ul class="member-list">' + (memberChips || '<li class="muted">No signals in this card.</li>') + '</ul>' +
          '<button class="btn btn--sm" type="button" data-action="add-selected" ' +
            'data-card="' + esc(card.id) + '">+ Add checked signals</button>' +
        '</details>' +
      '</article>';
  }

  function ungroupedSignalHTML(signal) {
    var checked = ui.selection[signal.id] ? ' checked' : '';
    var thumb = signal.thumbnail
      ? '<img class="sig-thumb-img" data-fallback="1" data-platform="' + esc(signal.platform) +
        '" data-label="' + esc(signal.label) + '" data-url="' + esc(signal.url) +
        '" loading="lazy" alt="" src="' + esc(signal.thumbnail) + '">'
      : '<span class="sig-thumb-fallback" style="background:' + platformColor(signal.platform) +
        '">' + esc(signal.platform.charAt(0)) + '</span>';
    return '<li class="sig-row">' +
      '<label class="sig-check">' +
        '<input type="checkbox" data-action="toggle-signal" data-signal="' + esc(signal.id) + '"' + checked + '>' +
        '<span class="sig-thumb">' + thumb + '</span>' +
        '<span class="sig-body">' +
          '<span class="sig-name" title="' + esc(signal.label) + '">' + esc(truncate(signal.label, 48)) + '</span>' +
          '<span class="sig-meta"><span class="chip-dot" style="background:' + platformColor(signal.platform) +
            '"></span>' + esc(signal.platform) +
            (signal.url ? ' \u00b7 <a href="' + esc(signal.url) + '" target="_blank" rel="noopener">' +
              esc(hostOf(signal.url) || 'link') + '</a>' : '') +
          '</span>' +
        '</span>' +
      '</label>' +
    '</li>';
  }

  function importerHTML(signalCount) {
    var target = targetCardCount(signalCount);
    var sample = JSON.stringify({
      cards: [
        { label: 'Chrome-core minimalism', rationale: 'Liquid-metal UI + product shots converging.', signalIds: ['sig_0', 'sig_3'], score: 82 },
        { label: 'Cottage-coded comfort', rationale: 'Soft analog nostalgia across IG + Pinterest.', signalIds: ['sig_1', 'sig_5', 'sig_9'], score: 67 }
      ]
    }, null, 2);
    return '<section class="importer-panel">' +
      '<h3>Paste Claude clustering JSON</h3>' +
      '<p class="muted">Cluster your signals in your own Claude session, then paste the JSON here. ' +
      'Each card needs a <code>label</code>; <code>rationale</code>, <code>signalIds</code> (ids, URLs, ' +
      'labels or 0-based indices) and <code>score</code> are optional. Suggested target for ' +
      signalCount + ' signals: <strong>~' + target + ' cards</strong> (range 3\u201325).</p>' +
      '<textarea id="clusterJsonInput" rows="10" class="json-input" ' +
        'placeholder="' + esc(sample) + '"></textarea>' +
      '<label class="inline-check"><input type="checkbox" data-action="toggle-replace"' +
        (ui.replaceOnImport ? ' checked' : '') + '> Replace existing cards (uncheck to append)</label>' +
      '<div class="importer-actions">' +
        '<button class="btn btn--primary" type="button" data-action="do-import">Validate &amp; import</button>' +
        '<button class="btn btn--ghost" type="button" data-action="toggle-import">Cancel</button>' +
      '</div>' +
    '</section>';
  }

  function messageHTML(msg) {
    if (!msg) return '';
    var details = (msg.details && msg.details.length)
      ? '<ul class="msg-details">' + msg.details.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>'
      : '';
    return '<div class="banner banner-' + esc(msg.kind) + '" data-action="dismiss-msg">' +
      '<span>' + esc(msg.text) + '</span>' + details +
      '<button class="banner-close" type="button" data-action="dismiss-msg" aria-label="Dismiss">\u00d7</button>' +
    '</div>';
  }

  /* ----------------------------------------------------------------------- *
   * Main render
   * ----------------------------------------------------------------------- */

  function render() {
    if (!currentContainer) return;
    var signals = getSignals();
    var cards = getCards();
    var byId = signalIndex(signals).byId;
    var grouped = groupedIdSet(cards);
    var ungrouped = signals.filter(function (s) { return !grouped[s.id]; });
    var target = targetCardCount(signals.length);
    var selCount = selectedSignalIds().length;

    var sampleBadge = roundIsSample()
      ? '<span class="tag tag-example" title="Pre-loaded demonstration data \u2014 clear it and add your own">Example data</span>'
      : '';

    var html = '' +
      '<div class="cards-view">' +
        '<header class="view-head">' +
          '<div>' +
            '<h2>Trend cards ' + sampleBadge + '</h2>' +
            '<p class="muted">' + cards.length + ' card' + (cards.length === 1 ? '' : 's') +
              ' \u00b7 ' + signals.length + ' signal' + (signals.length === 1 ? '' : 's') +
              ' \u00b7 ' + ungrouped.length + ' ungrouped \u00b7 suggested target ~' + target + ' cards</p>' +
          '</div>' +
          '<div class="view-actions">' +
            '<button class="btn btn--secondary" type="button" data-action="toggle-import">' +
              (ui.showImporter ? 'Hide importer' : 'Import clustering JSON') + '</button>' +
            '<button class="btn btn--primary" type="button" data-action="new-card"' +
              (selCount ? '' : ' disabled') + '>' +
              (selCount ? 'New card from ' + selCount + ' selected' : 'New card (select signals)') + '</button>' +
            (cards.length ? '<button class="btn btn--ghost btn--danger" type="button" data-action="clear-cards">Clear all</button>' : '') +
          '</div>' +
        '</header>' +

        messageHTML(ui.importMessage) +
        (ui.showImporter ? importerHTML(signals.length) : '') +

        '<div class="cards-layout">' +
          '<aside class="signals-pane">' +
            '<div class="pane-head">' +
              '<h3>Ungrouped signals (' + ungrouped.length + ')</h3>' +
              '<div class="pane-tools">' +
                '<button class="link-btn" type="button" data-action="select-all">All</button>' +
                '<button class="link-btn" type="button" data-action="select-none">None</button>' +
              '</div>' +
            '</div>' +
            (ungrouped.length
              ? '<ul class="sig-list">' + ungrouped.map(ungroupedSignalHTML).join('') + '</ul>'
              : (signals.length
                  ? '<p class="empty-pane">Every signal is grouped into a card. \u2705</p>'
                  : '<p class="empty-pane">No signals yet \u2014 add or import some on the Signals view.</p>')) +
          '</aside>' +

          '<section class="gallery-pane">' +
            (cards.length
              ? '<div class="card-gallery">' + cards.map(function (c) { return cardHTML(c, byId); }).join('') + '</div>'
              : '<div class="empty-gallery">' +
                  '<h3>No trend cards yet</h3>' +
                  '<p class="muted">Check some signals on the left and click <strong>New card</strong>, ' +
                  'or paste a Claude clustering JSON to bootstrap the gallery.</p>' +
                '</div>') +
          '</section>' +
        '</div>' +
      '</div>';

    currentContainer.innerHTML = html;
    wireImages(currentContainer);
  }

  // Replace broken / missing thumbnails with labeled link chips.
  function wireImages(root) {
    var imgs = root.querySelectorAll('img[data-fallback]');
    Array.prototype.forEach.call(imgs, function (img) {
      img.addEventListener('error', function () {
        var signal = {
          platform: img.getAttribute('data-platform') || 'Web',
          label: img.getAttribute('data-label') || '',
          url: img.getAttribute('data-url') || ''
        };
        var holder = document.createElement('span');
        if (img.classList.contains('sig-thumb-img')) {
          holder.className = 'sig-thumb-fallback';
          holder.style.background = platformColor(signal.platform);
          holder.textContent = (signal.platform || '?').charAt(0);
        } else {
          holder.innerHTML = linkChipHTML(signal);
        }
        var target = img.closest('.trend-thumb') || img;
        if (target && target.parentNode) {
          target.parentNode.replaceChild(holder.firstChild || holder, target);
        }
      });
    });
  }

  /* ----------------------------------------------------------------------- *
   * Event delegation
   * ----------------------------------------------------------------------- */

  function onClick(e) {
    var t = e.target.closest('[data-action]');
    if (!t || !currentContainer.contains(t)) return;
    var action = t.getAttribute('data-action');

    switch (action) {
      case 'toggle-import':
        ui.showImporter = !ui.showImporter;
        render();
        break;
      case 'do-import':
        doImport();
        break;
      case 'toggle-replace':
        ui.replaceOnImport = !!t.checked;
        break;
      case 'new-card':
        createCardFromSelection();
        break;
      case 'clear-cards':
        clearAllCards();
        break;
      case 'delete-card':
        deleteCard(t.getAttribute('data-card'));
        break;
      case 'add-selected':
        addSelectedToCard(t.getAttribute('data-card'));
        break;
      case 'remove-member':
        removeMember(t.getAttribute('data-card'), t.getAttribute('data-signal'));
        break;
      case 'select-all':
        getSignals().filter(function (s) { return !groupedIdSet(getCards())[s.id]; })
          .forEach(function (s) { ui.selection[s.id] = true; });
        render();
        break;
      case 'select-none':
        ui.selection = {};
        render();
        break;
      case 'dismiss-msg':
        ui.importMessage = null;
        render();
        break;
      default:
        break;
    }
  }

  function onChange(e) {
    var t = e.target.closest('[data-action]');
    if (!t || !currentContainer.contains(t)) return;
    var action = t.getAttribute('data-action');
    if (action === 'toggle-signal') {
      var id = t.getAttribute('data-signal');
      if (t.checked) ui.selection[id] = true; else delete ui.selection[id];
    } else if (action === 'toggle-replace') {
      ui.replaceOnImport = !!t.checked;
    } else if (action === 'edit-label') {
      updateCardField(t.getAttribute('data-card'), 'label', t.value.trim() || 'Untitled trend');
    } else if (action === 'edit-rationale') {
      updateCardField(t.getAttribute('data-card'), 'rationale', t.value);
    }
  }

  /* ----------------------------------------------------------------------- *
   * Public entry point + self-mounting hash routing
   * ----------------------------------------------------------------------- */

  function bind(container) {
    if (currentContainer === container) return;
    currentContainer = container;
    if (!container.__cardsBound) {
      container.addEventListener('click', onClick);
      container.addEventListener('change', onChange);
      container.__cardsBound = true;
    }
  }

  function renderInto(container) {
    if (!container) return;
    bind(container);
    render();
  }

  var CardsView = {
    render: renderInto,
    refresh: function () { if (currentContainer) render(); },
    targetCardCount: targetCardCount,
    compositeScore: compositeScore,
    parseClusteringJSON: parseClusteringJSON
  };

  // Export under several namespaces so whichever convention index.html's router
  // uses, it can find this view.
  window.CardsView = CardsView;
  window.TrendDeck = window.TrendDeck || {};
  window.TrendDeck.views = window.TrendDeck.views || {};
  window.TrendDeck.views.cards = CardsView;

  // Optional self-mounting: if a cards-specific container exists, or the hash
  // route points at the cards view, render automatically. This keeps the module
  // working even if index.html only loads scripts without an explicit router.
  function routeIsCards() {
    var h = (window.location.hash || '').toLowerCase();
    return h.indexOf('card') !== -1;
  }

  function findContainer() {
    return document.querySelector('#cards-view') ||
      document.querySelector('[data-view="cards"]') ||
      document.querySelector('#view') ||
      document.querySelector('.app-view') ||
      document.querySelector('#app-view') ||
      document.querySelector('#main-view');
  }

  function maybeMount() {
    // Defer to index.html's hash router when present: it dispatches
    // `trenddeck:render` and we mount into #cards-root from that handler.
    // Rendering here too would target the whole [data-view="cards"] section and
    // wipe its static header.
    if (window.TrendDeck && typeof window.TrendDeck.refresh === 'function') return;
    var dedicated = document.querySelector('#cards-view, [data-view="cards"]');
    if (dedicated) { renderInto(dedicated); return; }
    if (routeIsCards()) {
      var c = findContainer();
      if (c) renderInto(c);
    }
  }

  function init() {
    if (window.__trenddeckCardsInit) return;
    window.__trenddeckCardsInit = true;
    window.addEventListener('hashchange', maybeMount);
    document.addEventListener('trenddeck:round-changed', function () {
      if (currentContainer) render();
    });
    // index.html's hash router fires `trenddeck:render` with detail.route when a
    // view becomes active; mount into #cards-root so the gallery paints on the
    // initial route and on every nav change, not only on hashchange.
    document.addEventListener('trenddeck:render', function (ev) {
      var route = String((ev && ev.detail && ev.detail.route) || '').toLowerCase();
      if (route.indexOf('card') === -1) return;
      var root = document.getElementById('cards-root');
      if (root) renderInto(root);
    });
    maybeMount();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
