/*
 * js/sample-data.js — TrendDeck bundled sample round.
 *
 * A complete, realistic example trend-voting round so the whole
 * create -> cards -> vote -> dashboard -> brief flow is populated on the
 * very first load (before the user has entered anything).
 *
 * store.js seeds `window.TRENDDECK_SAMPLE.round` into localStorage on first
 * run when storage is empty. Everything in here is EXAMPLE DATA and is tagged
 * with `isSample: true` so the UI can clearly label it and the user can wipe
 * it with a single "Clear sample data" action and enter their own.
 *
 * Data model (mirrors store.js):
 *   studio -> round -> { signals[], cards[], votes[], settings }
 *   signal   = { id, label, sourceUrl, platform, thumbnailUrl, note, createdAt }
 *   card     = { id, label, rationale, signalIds[], sources{platform:count},
 *                score, thumbnailUrl, createdAt }
 *   vote     = { id, sessionId, department, winnerCardId, loserCardId,
 *                pairKey, createdAt }
 *
 * No external dependencies. Pure data + a couple of tiny helpers.
 */
(function (global) {
  'use strict';

  // Stable, human-readable timestamps for the sample (kept in the recent past
  // relative to nothing in particular — they are just illustrative).
  var BASE_DAY = '2026-06-22';
  function ts(day, h, m) {
    var hh = (h < 10 ? '0' : '') + h;
    var mm = (m < 10 ? '0' : '') + m;
    return (day || BASE_DAY) + 'T' + hh + ':' + mm + ':00.000Z';
  }

  // ---------------------------------------------------------------------------
  // 1) Raw signals (~20). These are the candidate trend signals an admin would
  //    paste or CSV-import before grouping them into cards.
  // ---------------------------------------------------------------------------
  var SIGNALS = [
    {
      id: 'sig-01',
      label: 'Chunky "claymorphism" 3D icon sets all over app onboarding',
      sourceUrl: 'https://dribbble.com/shots/claymorphism-icons',
      platform: 'Dribbble',
      thumbnailUrl: '',
      note: 'Soft inflated shapes, pastel gradients, long soft shadows.',
      createdAt: ts('2026-06-20', 9, 12)
    },
    {
      id: 'sig-02',
      label: 'Brutalist mono-type portfolios with raw HTML aesthetic',
      sourceUrl: 'https://www.are.na/channel/brutalist-web',
      platform: 'Are.na',
      thumbnailUrl: '',
      note: 'Times New Roman, blue underlines, deliberate "unstyled" look.',
      createdAt: ts('2026-06-20', 9, 28)
    },
    {
      id: 'sig-03',
      label: 'Risograph-style grain + duotone in editorial layouts',
      sourceUrl: 'https://www.instagram.com/p/riso-editorial',
      platform: 'Instagram',
      thumbnailUrl: '',
      note: 'Misregistered ink, two-color overprint, visible halftone.',
      createdAt: ts('2026-06-20', 10, 2)
    },
    {
      id: 'sig-04',
      label: 'AI "liquid chrome" type treatments on music covers',
      sourceUrl: 'https://www.behance.net/gallery/liquid-chrome',
      platform: 'Behance',
      thumbnailUrl: '',
      note: 'Y2K metal, blobby reflective 3D lettering.',
      createdAt: ts('2026-06-20', 10, 40)
    },
    {
      id: 'sig-05',
      label: 'Hyper-minimal Swiss grids making a comeback in fintech',
      sourceUrl: 'https://www.pinterest.com/pin/swiss-fintech',
      platform: 'Pinterest',
      thumbnailUrl: '',
      note: 'Helvetica, lots of whitespace, strict 12-col grid.',
      createdAt: ts('2026-06-20', 11, 5)
    },
    {
      id: 'sig-06',
      label: 'Bento-box dashboards everywhere in SaaS marketing pages',
      sourceUrl: 'https://www.behance.net/gallery/bento-saas',
      platform: 'Behance',
      thumbnailUrl: '',
      note: 'Rounded modular cards, mixed sizes, Apple keynote vibe.',
      createdAt: ts('2026-06-20', 11, 33)
    },
    {
      id: 'sig-07',
      label: 'Hand-drawn doodle annotations layered over clean UI',
      sourceUrl: 'https://dribbble.com/shots/doodle-annotations',
      platform: 'Dribbble',
      thumbnailUrl: '',
      note: 'Marker scribbles, arrows, circled CTAs.',
      createdAt: ts('2026-06-20', 12, 1)
    },
    {
      id: 'sig-08',
      label: 'Maximalist color clash — acid green + hot magenta',
      sourceUrl: 'https://www.instagram.com/p/acid-maximal',
      platform: 'Instagram',
      thumbnailUrl: '',
      note: 'Vibrating complementary palettes, anti-tasteful.',
      createdAt: ts('2026-06-21', 9, 15)
    },
    {
      id: 'sig-09',
      label: 'Spatial / visionOS glass panels in concept reels',
      sourceUrl: 'https://www.youtube.com/watch?v=spatial-glass',
      platform: 'YouTube',
      thumbnailUrl: '',
      note: 'Frosted translucency, depth, floating windows.',
      createdAt: ts('2026-06-21', 9, 44)
    },
    {
      id: 'sig-10',
      label: 'Sticker-bomb collage UI in Gen-Z consumer apps',
      sourceUrl: 'https://dribbble.com/shots/sticker-bomb-ui',
      platform: 'Dribbble',
      thumbnailUrl: '',
      note: 'Cut-out stickers, tape, scrapbook energy.',
      createdAt: ts('2026-06-21', 10, 10)
    },
    {
      id: 'sig-11',
      label: 'Variable fonts animating weight on scroll',
      sourceUrl: 'https://codepen.io/collection/variable-fonts',
      platform: 'CodePen',
      thumbnailUrl: '',
      note: 'Type that breathes — width/weight tied to scroll position.',
      createdAt: ts('2026-06-21', 10, 52)
    },
    {
      id: 'sig-12',
      label: 'Nostalgic 90s desktop / skeuomorphic window chrome',
      sourceUrl: 'https://www.are.na/channel/90s-desktop',
      platform: 'Are.na',
      thumbnailUrl: '',
      note: 'Beveled buttons, pixel icons, title bars.',
      createdAt: ts('2026-06-21', 11, 20)
    },
    {
      id: 'sig-13',
      label: 'Earthy "new naturalism" palettes — clay, sage, ochre',
      sourceUrl: 'https://www.pinterest.com/pin/new-naturalism',
      platform: 'Pinterest',
      thumbnailUrl: '',
      note: 'Muted organic tones, warm neutrals, calm.',
      createdAt: ts('2026-06-21', 11, 48)
    },
    {
      id: 'sig-14',
      label: 'Kinetic oversized typography as the entire hero',
      sourceUrl: 'https://www.behance.net/gallery/kinetic-type',
      platform: 'Behance',
      thumbnailUrl: '',
      note: 'Type IS the layout, edge-to-edge, moving.',
      createdAt: ts('2026-06-21', 12, 30)
    },
    {
      id: 'sig-15',
      label: 'Pixel-art mascots returning in dev-tool branding',
      sourceUrl: 'https://dribbble.com/shots/pixel-mascot',
      platform: 'Dribbble',
      thumbnailUrl: '',
      note: 'Low-res characters, playful, retro game feel.',
      createdAt: ts('2026-06-22', 9, 5)
    },
    {
      id: 'sig-16',
      label: 'Glassmorphism 2.0 with noise + grain texture',
      sourceUrl: 'https://www.behance.net/gallery/glass-grain',
      platform: 'Behance',
      thumbnailUrl: '',
      note: 'Blur panels but grittier — texture over plastic.',
      createdAt: ts('2026-06-22', 9, 26)
    },
    {
      id: 'sig-17',
      label: 'Anti-AI "made by humans" hand-lettered badges',
      sourceUrl: 'https://www.instagram.com/p/human-made-badge',
      platform: 'Instagram',
      thumbnailUrl: '',
      note: 'Craft seals signaling authenticity vs generated work.',
      createdAt: ts('2026-06-22', 9, 51)
    },
    {
      id: 'sig-18',
      label: 'Data-dense "terminal" aesthetics in crypto/AI dashboards',
      sourceUrl: 'https://dribbble.com/shots/terminal-ui',
      platform: 'Dribbble',
      thumbnailUrl: '',
      note: 'Monospace, green-on-black, scanlines, command bars.',
      createdAt: ts('2026-06-22', 10, 18)
    },
    {
      id: 'sig-19',
      label: 'Soft gradient mesh backgrounds replacing flat fills',
      sourceUrl: 'https://www.pinterest.com/pin/mesh-gradient',
      platform: 'Pinterest',
      thumbnailUrl: '',
      note: 'Blurred multi-stop gradients, aurora-like.',
      createdAt: ts('2026-06-22', 10, 42)
    },
    {
      id: 'sig-20',
      label: 'Scrappy phone-shot UGC look in brand campaigns',
      sourceUrl: 'https://www.instagram.com/p/ugc-scrappy',
      platform: 'Instagram',
      thumbnailUrl: '',
      note: 'Flash photos, imperfect crops, authenticity over polish.',
      createdAt: ts('2026-06-22', 11, 9)
    }
  ];

  // ---------------------------------------------------------------------------
  // 2) Trend cards (12). Each groups one or more signals, carries a rationale,
  //    a source-platform breakdown, a composite score, and a thumbnail.
  // ---------------------------------------------------------------------------
  var CARDS = [
    {
      id: 'card-01',
      label: 'Tactile 3D & Claymorphism',
      rationale:
        'Soft, inflated 3D forms with pastel gradients are dominating onboarding ' +
        'and app store art. Reads friendly and premium; pairs well with our ' +
        'consumer mobile work.',
      signalIds: ['sig-01', 'sig-16'],
      sources: { Dribbble: 1, Behance: 1 },
      score: 78,
      thumbnailUrl: '',
      createdAt: ts('2026-06-22', 13, 2)
    },
    {
      id: 'card-02',
      label: 'Raw Brutalist Web',
      rationale:
        'Deliberately "unstyled", mono-type, raw-HTML portfolios. A reaction to ' +
        'over-polished templates — signals taste and confidence for editorial clients.',
      signalIds: ['sig-02', 'sig-12'],
      sources: { 'Are.na': 2 },
      score: 61,
      thumbnailUrl: '',
      createdAt: ts('2026-06-22', 13, 6)
    },
    {
      id: 'card-03',
      label: 'Riso & Print Texture',
      rationale:
        'Risograph grain, duotone overprint and visible halftone bring a crafted, ' +
        'analog warmth to digital editorial. Strong fit for culture/arts clients.',
      signalIds: ['sig-03'],
      sources: { Instagram: 1 },
      score: 66,
      thumbnailUrl: '',
      createdAt: ts('2026-06-22', 13, 9)
    },
    {
      id: 'card-04',
      label: 'Liquid Chrome / Y2K Metal',
      rationale:
        'Reflective blobby chrome lettering — nostalgic Y2K maximalism, accelerated ' +
        'by AI image tools. High impact for music & fashion launches.',
      signalIds: ['sig-04'],
      sources: { Behance: 1 },
      score: 70,
      thumbnailUrl: '',
      createdAt: ts('2026-06-22', 13, 12)
    },
    {
      id: 'card-05',
      label: 'Neo-Swiss Minimalism',
      rationale:
        'Strict grids, generous whitespace and Helvetica are back in fintech and B2B. ' +
        'Reads trustworthy and timeless — a safe, durable bet.',
      signalIds: ['sig-05'],
      sources: { Pinterest: 1 },
      score: 64,
      thumbnailUrl: '',
      createdAt: ts('2026-06-22', 13, 15)
    },
    {
      id: 'card-06',
      label: 'Bento-Box Layouts',
      rationale:
        'Modular rounded cards in mixed sizes — the default for SaaS marketing pages. ' +
        'Highly reusable in our component system; low risk, broad applicability.',
      signalIds: ['sig-06'],
      sources: { Behance: 1 },
      score: 72,
      thumbnailUrl: '',
      createdAt: ts('2026-06-22', 13, 18)
    },
    {
      id: 'card-07',
      label: 'Doodle & Sticker Collage',
      rationale:
        'Hand-drawn annotations and sticker-bomb collage inject personality into clean ' +
        'UI. Resonates with Gen-Z consumer brands; risky for enterprise.',
      signalIds: ['sig-07', 'sig-10'],
      sources: { Dribbble: 2 },
      score: 58,
      thumbnailUrl: '',
      createdAt: ts('2026-06-22', 13, 21)
    },
    {
      id: 'card-08',
      label: 'Maximalist Color Clash',
      rationale:
        'Acid green, hot magenta, vibrating complementary palettes — loud, anti-tasteful ' +
        'and attention-grabbing. Polarizing but memorable for launches.',
      signalIds: ['sig-08'],
      sources: { Instagram: 1 },
      score: 52,
      thumbnailUrl: '',
      createdAt: ts('2026-06-22', 13, 24)
    },
    {
      id: 'card-09',
      label: 'Spatial Glass (visionOS)',
      rationale:
        'Frosted translucency, depth and floating panels from spatial computing concept ' +
        'reels. Forward-looking; signals innovation for tech clients.',
      signalIds: ['sig-09', 'sig-19'],
      sources: { YouTube: 1, Pinterest: 1 },
      score: 69,
      thumbnailUrl: '',
      createdAt: ts('2026-06-22', 13, 27)
    },
    {
      id: 'card-10',
      label: 'Kinetic Variable Type',
      rationale:
        'Oversized type as the whole layout, with variable fonts animating weight and ' +
        'width on scroll. The hero is the typography — striking and ownable.',
      signalIds: ['sig-11', 'sig-14'],
      sources: { CodePen: 1, Behance: 1 },
      score: 74,
      thumbnailUrl: '',
      createdAt: ts('2026-06-22', 13, 30)
    },
    {
      id: 'card-11',
      label: 'New Naturalism Palettes',
      rationale:
        'Earthy clay, sage and ochre tones — calm, organic, wellness-coded. Differentiates ' +
        'from the sea of saturated tech blues.',
      signalIds: ['sig-13'],
      sources: { Pinterest: 1 },
      score: 60,
      thumbnailUrl: '',
      createdAt: ts('2026-06-22', 13, 33)
    },
    {
      id: 'card-12',
      label: 'Human-Made / Anti-AI Craft',
      rationale:
        'Hand-lettered "made by humans" badges, pixel mascots and scrappy phone-shot UGC ' +
        'signal authenticity in an AI-saturated feed. Strong brand-trust angle.',
      signalIds: ['sig-15', 'sig-17', 'sig-18', 'sig-20'],
      sources: { Dribbble: 2, Instagram: 2 },
      score: 67,
      thumbnailUrl: '',
      createdAt: ts('2026-06-22', 13, 36)
    }
  ];

  // ---------------------------------------------------------------------------
  // 3) Anonymous votes across departments. Built head-to-head so the dashboard
  //    has a believable leaderboard with a clear top tier and a long tail.
  //    Each vote: a session voted a winner over a loser for a random pair.
  // ---------------------------------------------------------------------------
  var DEPARTMENTS = ['Design', 'Strategy', 'Engineering', 'Account', 'Motion', 'Unspecified'];

  function pairKey(a, b) {
    return [a, b].sort().join('::');
  }

  // Compact authoring format: [winner, loser, department, session, day, h, m]
  var RAW_VOTES = [
    // --- Session s1 (Design) ---
    ['card-01', 'card-08', 'Design', 's1', '2026-06-23', 9, 12],
    ['card-10', 'card-02', 'Design', 's1', '2026-06-23', 9, 13],
    ['card-06', 'card-11', 'Design', 's1', '2026-06-23', 9, 14],
    ['card-01', 'card-05', 'Design', 's1', '2026-06-23', 9, 15],
    ['card-04', 'card-07', 'Design', 's1', '2026-06-23', 9, 16],
    ['card-10', 'card-12', 'Design', 's1', '2026-06-23', 9, 17],
    ['card-09', 'card-03', 'Design', 's1', '2026-06-23', 9, 18],
    // --- Session s2 (Strategy) ---
    ['card-06', 'card-08', 'Strategy', 's2', '2026-06-23', 10, 2],
    ['card-05', 'card-07', 'Strategy', 's2', '2026-06-23', 10, 3],
    ['card-01', 'card-12', 'Strategy', 's2', '2026-06-23', 10, 4],
    ['card-06', 'card-04', 'Strategy', 's2', '2026-06-23', 10, 5],
    ['card-10', 'card-11', 'Strategy', 's2', '2026-06-23', 10, 6],
    ['card-09', 'card-02', 'Strategy', 's2', '2026-06-23', 10, 7],
    // --- Session s3 (Engineering) ---
    ['card-06', 'card-10', 'Engineering', 's3', '2026-06-23', 11, 20],
    ['card-05', 'card-08', 'Engineering', 's3', '2026-06-23', 11, 21],
    ['card-09', 'card-07', 'Engineering', 's3', '2026-06-23', 11, 22],
    ['card-06', 'card-12', 'Engineering', 's3', '2026-06-23', 11, 23],
    ['card-01', 'card-03', 'Engineering', 's3', '2026-06-23', 11, 24],
    ['card-05', 'card-11', 'Engineering', 's3', '2026-06-23', 11, 25],
    // --- Session s4 (Account) ---
    ['card-01', 'card-07', 'Account', 's4', '2026-06-23', 13, 5],
    ['card-06', 'card-09', 'Account', 's4', '2026-06-23', 13, 6],
    ['card-12', 'card-08', 'Account', 's4', '2026-06-23', 13, 7],
    ['card-10', 'card-04', 'Account', 's4', '2026-06-23', 13, 8],
    ['card-01', 'card-11', 'Account', 's4', '2026-06-23', 13, 9],
    ['card-05', 'card-02', 'Account', 's4', '2026-06-23', 13, 10],
    // --- Session s5 (Motion) ---
    ['card-10', 'card-06', 'Motion', 's5', '2026-06-23', 14, 30],
    ['card-04', 'card-08', 'Motion', 's5', '2026-06-23', 14, 31],
    ['card-10', 'card-01', 'Motion', 's5', '2026-06-23', 14, 32],
    ['card-09', 'card-11', 'Motion', 's5', '2026-06-23', 14, 33],
    ['card-04', 'card-12', 'Motion', 's5', '2026-06-23', 14, 34],
    ['card-10', 'card-03', 'Motion', 's5', '2026-06-23', 14, 35],
    // --- Session s6 (Design) ---
    ['card-01', 'card-02', 'Design', 's6', '2026-06-24', 9, 40],
    ['card-06', 'card-07', 'Design', 's6', '2026-06-24', 9, 41],
    ['card-10', 'card-08', 'Design', 's6', '2026-06-24', 9, 42],
    ['card-09', 'card-12', 'Design', 's6', '2026-06-24', 9, 43],
    ['card-01', 'card-04', 'Design', 's6', '2026-06-24', 9, 44],
    ['card-11', 'card-03', 'Design', 's6', '2026-06-24', 9, 45],
    // --- Session s7 (Strategy) ---
    ['card-06', 'card-01', 'Strategy', 's7', '2026-06-24', 10, 50],
    ['card-05', 'card-12', 'Strategy', 's7', '2026-06-24', 10, 51],
    ['card-10', 'card-07', 'Strategy', 's7', '2026-06-24', 10, 52],
    ['card-09', 'card-08', 'Strategy', 's7', '2026-06-24', 10, 53],
    ['card-06', 'card-02', 'Strategy', 's7', '2026-06-24', 10, 54],
    ['card-04', 'card-11', 'Strategy', 's7', '2026-06-24', 10, 55],
    // --- Session s8 (Unspecified / anonymous) ---
    ['card-10', 'card-05', 'Unspecified', 's8', '2026-06-24', 12, 10],
    ['card-01', 'card-09', 'Unspecified', 's8', '2026-06-24', 12, 11],
    ['card-06', 'card-03', 'Unspecified', 's8', '2026-06-24', 12, 12],
    ['card-12', 'card-07', 'Unspecified', 's8', '2026-06-24', 12, 13],
    ['card-04', 'card-02', 'Unspecified', 's8', '2026-06-24', 12, 14],
    ['card-10', 'card-11', 'Unspecified', 's8', '2026-06-24', 12, 15],
    // --- Session s9 (Engineering) ---
    ['card-06', 'card-05', 'Engineering', 's9', '2026-06-24', 15, 0],
    ['card-10', 'card-09', 'Engineering', 's9', '2026-06-24', 15, 1],
    ['card-01', 'card-08', 'Engineering', 's9', '2026-06-24', 15, 2],
    ['card-04', 'card-03', 'Engineering', 's9', '2026-06-24', 15, 3],
    ['card-06', 'card-12', 'Engineering', 's9', '2026-06-24', 15, 4],
    // --- Session s10 (single-person dept, exercises suppression threshold) ---
    ['card-10', 'card-04', 'Motion', 's10', '2026-06-24', 16, 20],
    ['card-06', 'card-08', 'Motion', 's10', '2026-06-24', 16, 21],
    ['card-01', 'card-12', 'Motion', 's10', '2026-06-24', 16, 22]
  ];

  var VOTES = RAW_VOTES.map(function (v, i) {
    var winner = v[0];
    var loser = v[1];
    var n = i + 1;
    var idnum = (n < 10 ? '0' : '') + n;
    return {
      id: 'vote-' + idnum,
      sessionId: v[3],
      department: v[2],
      winnerCardId: winner,
      loserCardId: loser,
      pairKey: pairKey(winner, loser),
      createdAt: ts(v[4], v[5], v[6]),
      isSample: true
    };
  });

  // ---------------------------------------------------------------------------
  // 4) Assemble the full sample round.
  // ---------------------------------------------------------------------------
  var ROUND = {
    id: 'sample-round-2026-q2',
    isSample: true,
    name: 'SS26 Visual Trends — Studio Round (Sample)',
    studio: {
      id: 'sample-studio',
      name: 'Northlight Studio (sample)'
    },
    title: 'Q2 2026 Visual Trends — Studio Vote (Sample)',
    description:
      'Example round bundled with TrendDeck so you can see the full create -> cards -> ' +
      'vote -> dashboard -> brief flow without entering anything. Clear it any time to ' +
      'start your own round.',
    createdAt: ts('2026-06-22', 8, 0),
    closed: false,
    settings: {
      // Departments with fewer than this many votes are suppressed in the
      // by-department breakdown to protect anonymity. Admin-adjustable.
      deptSuppressionThreshold: 5,
      pairsPerSession: 6,
      roundClosed: false
    },
    signals: SIGNALS,
    cards: CARDS,
    votes: VOTES,
    departments: DEPARTMENTS
  };

  // Mark sample membership on signals & cards too (so the UI can label clearly).
  ROUND.signals.forEach(function (s) { s.isSample = true; });
  ROUND.cards.forEach(function (c) { c.isSample = true; });

  // ---------------------------------------------------------------------------
  // 5) Public API. store.js reads `window.TRENDDECK_SAMPLE.round` and may call
  //    `clone()` to get a fresh, independent copy when (re)seeding.
  // ---------------------------------------------------------------------------
  function clone() {
    // Deep clone so a seed never shares references with the canonical sample.
    return JSON.parse(JSON.stringify(ROUND));
  }

  var API = {
    round: ROUND,
    signals: SIGNALS,
    cards: CARDS,
    votes: VOTES,
    departments: DEPARTMENTS,
    clone: clone
  };

  global.TRENDDECK_SAMPLE = API;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  }
})(typeof window !== 'undefined' ? window : this);
