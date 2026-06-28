/*
 * improvement-cycles — a reusable, project-agnostic multi-agent improvement pipeline.
 * ----------------------------------------------------------------------------------
 * Runs N iterative cycles of: review -> prioritize -> delegate & specialize -> implement.
 * Each cycle reviews the ACTUAL committed result of the previous one (cycles are serial),
 * so regressions and half-done work get caught like a real delivery cadence.
 *
 * Personas (all overridable via args.personas):
 *   Reviewers   — realistic, senior, NOT sycophantic. Default: a Senior Product Manager
 *                 and a Senior Design/Art Director at a live product company.
 *   Delivery Lead — turns findings into one focused, ruthlessly-prioritized milestone.
 *   Designers   — draft buildable specs. Default: a System Experience Designer (flows,
 *                 states, data, edge cases) and a UI/UX Specialist (visual/interaction polish).
 *   Engineer    — implements the specs in the real files, syntax/sanity-checks, and commits.
 *
 * Invoke:
 *   Workflow({ name: 'improvement-cycles' })                       // all defaults, 4 cycles
 *   Workflow({ name: 'improvement-cycles', args: { cycles: 3 } })  // 3 cycles
 *   Workflow({ name: 'improvement-cycles', args: {
 *     cycles: 4,
 *     scope: 'functionality AND user interface polish',   // what to improve
 *     companyContext: 'a live games company',             // framing for the personas
 *     appContext: '...optional hand-written project brief...', // skips auto-discovery if set
 *     projectDir: '/abs/path/to/repo',                    // default: current working dir
 *     commit: true,                                       // engineer commits each cycle
 *     writeLog: true,                                     // final agent writes docs/improvement-cycles.md
 *     personas: { reviewers: [...], lead: {...}, designers: [...], engineer: {...} }, // see DEFAULTS below
 *   }})
 *
 * Notes:
 *   - Run it from inside the target project (its repo is the working directory). The engineer
 *     commits on the CURRENTLY CHECKED-OUT branch and never switches branches — check out your
 *     feature branch before running.
 *   - Works on any stack: a discovery agent maps the repo and writes the project brief that the
 *     personas reason against, unless you pass args.appContext.
 *   - Stays within whatever the project already is (no new deps / build steps unless the specs
 *     justify them and the engineer judges it safe).
 */

export const meta = {
  name: 'improvement-cycles',
  description: 'N persona-driven review prioritize spec implement cycles improving a project (functionality + UI polish)',
  whenToUse: 'Iteratively harden and polish a project with a team of reviewer + worker subagent personas over several serial cycles.',
  phases: [
    { title: 'Discover' },
    { title: 'Cycle 1 Review' }, { title: 'Cycle 1 Prioritize' }, { title: 'Cycle 1 Spec' }, { title: 'Cycle 1 Implement' },
    { title: 'Cycle 2 Review' }, { title: 'Cycle 2 Prioritize' }, { title: 'Cycle 2 Spec' }, { title: 'Cycle 2 Implement' },
    { title: 'Cycle 3 Review' }, { title: 'Cycle 3 Prioritize' }, { title: 'Cycle 3 Spec' }, { title: 'Cycle 3 Implement' },
    { title: 'Cycle 4 Review' }, { title: 'Cycle 4 Prioritize' }, { title: 'Cycle 4 Spec' }, { title: 'Cycle 4 Implement' },
    { title: 'Document' },
  ],
}

/* ----------------------------- config + defaults ----------------------------- */

const A = (typeof args === 'object' && args) ? args : {}
const CYCLES = Math.max(1, Math.min(8, Number(A.cycles) || 4))
const SCOPE = A.scope || 'functionality AND user interface polish'
const COMPANY = A.companyContext || 'an established company shipping a live product'
const PROJECT_DIR = A.projectDir || '.'
const DO_COMMIT = A.commit !== false
const DO_LOG = A.writeLog !== false

const DEFAULT_PERSONAS = {
  reviewers: [
    { title: 'Senior Product Manager', charter: 'You own product outcomes: does the product actually do its job end-to-end for a real user? You care about user flows, missing functionality, friction, clarity of the value proposition, data integrity, edge cases, onboarding, and whether each surface earns its place.' },
    { title: 'Senior Design / Art Director', charter: 'You own the visual and experiential quality bar: hierarchy, typography, spacing, color, layout, consistency, motion, brand feel, and whether this looks like a product a design-led team would be proud to ship. You have strong, specific taste.' },
  ],
  lead: { title: 'Expert Delivery Lead', charter: 'You turn a pile of findings into one focused, achievable milestone, ruthlessly prioritized, and assign each task to the right specialist.' },
  designers: [
    { key: 'system-experience-designer', title: 'Expert System Experience Designer', charter: 'You design systems of interaction: end-to-end flows, every state (empty/loading/error/success), data modeling implications, edge cases, information architecture, and behavior under real, messy data.' },
    { key: 'ui-ux-specialist', title: 'Expert UI/UX Specialist', charter: 'You turn intent into precise visual and interaction design: layout grids, spacing rhythm, type scale, color usage, components, microcopy, motion, responsive behavior, and accessibility.' },
  ],
  engineer: { title: 'Expert Software Engineer', charter: 'You implement specs faithfully in the real codebase, matching existing conventions, and you verify your work before committing.' },
}

const P = A.personas || {}
const REVIEWERS = Array.isArray(P.reviewers) && P.reviewers.length ? P.reviewers : DEFAULT_PERSONAS.reviewers
const LEAD = P.lead || DEFAULT_PERSONAS.lead
const DESIGNERS = Array.isArray(P.designers) && P.designers.length ? P.designers : DEFAULT_PERSONAS.designers
const ENGINEER = P.engineer || DEFAULT_PERSONAS.engineer
const DESIGNER_KEYS = DESIGNERS.map(function (d) { return d.key })

/* --------------------------------- schemas --------------------------------- */

const DISCOVERY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['brief', 'stack', 'keyFiles', 'constraints', 'howToVerify'],
  properties: {
    brief: { type: 'string', description: 'What the project is and does, in 4-8 sentences. Enough for a reviewer to reason about it.' },
    stack: { type: 'string', description: 'Languages, frameworks, build/runtime, notable libraries.' },
    keyFiles: { type: 'array', items: { type: 'string' }, description: 'Important files/dirs with a one-line role each.' },
    constraints: { type: 'array', items: { type: 'string' }, description: 'Invariants to preserve (e.g. no backend, no build step, target platform, style conventions).' },
    howToVerify: { type: 'string', description: 'How an engineer can sanity-check a change (build/test/lint/syntax-check/smoke command), based on what the repo actually supports.' },
  },
}

const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['persona', 'overallAssessment', 'findings'],
  properties: {
    persona: { type: 'string' },
    overallAssessment: { type: 'string', description: 'Blunt 2-4 sentence verdict on the current state from this persona.' },
    findings: {
      type: 'array', minItems: 4, maxItems: 10,
      items: {
        type: 'object', additionalProperties: false,
        required: ['area', 'category', 'severity', 'observation', 'impact', 'suggestion'],
        properties: {
          area: { type: 'string', description: 'Which surface/feature/file.' },
          category: { type: 'string', enum: ['functionality', 'ui'] },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          observation: { type: 'string', description: 'Concrete, specific problem grounded in the actual code/UX. No vague praise.' },
          impact: { type: 'string', description: 'Why it matters to a real user.' },
          suggestion: { type: 'string', description: 'Concrete direction for a fix.' },
        },
      },
    },
  },
}

const PRIORITIZE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['milestoneName', 'rationale', 'tasks', 'deferred'],
  properties: {
    milestoneName: { type: 'string' },
    rationale: { type: 'string', description: 'Why this set of tasks now; the through-line of the milestone.' },
    tasks: {
      type: 'array', minItems: 3, maxItems: 6,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'title', 'category', 'priority', 'assignTo', 'problem', 'desiredOutcome'],
        properties: {
          id: { type: 'string', description: 'Short stable id like C1-T1.' },
          title: { type: 'string' },
          category: { type: 'string', enum: ['functionality', 'ui'] },
          priority: { type: 'string', enum: ['P0', 'P1', 'P2'] },
          assignTo: { type: 'string', enum: DESIGNER_KEYS, description: 'Which designer drafts the spec.' },
          problem: { type: 'string' },
          desiredOutcome: { type: 'string' },
        },
      },
    },
    deferred: { type: 'array', items: { type: 'string' }, description: 'Findings intentionally NOT in this milestone, each with a one-line reason.' },
  },
}

const SPEC_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['designer', 'specs'],
  properties: {
    designer: { type: 'string' },
    specs: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['taskId', 'title', 'approach', 'details', 'acceptanceCriteria', 'filesAffected'],
        properties: {
          taskId: { type: 'string' },
          title: { type: 'string' },
          approach: { type: 'string', description: 'The design decision and why.' },
          details: { type: 'array', items: { type: 'string' }, description: 'Specific, implementable instructions: states, copy, tokens, layout, behavior. Concrete enough to build without guessing.' },
          acceptanceCriteria: { type: 'array', items: { type: 'string' } },
          filesAffected: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

const IMPLEMENT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['summary', 'changes', 'committed', 'commitHash', 'notes'],
  properties: {
    summary: { type: 'string' },
    changes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['taskId', 'files', 'description'],
        properties: {
          taskId: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          description: { type: 'string' },
        },
      },
    },
    committed: { type: 'boolean' },
    commitHash: { type: 'string', description: 'Short hash of the commit made this cycle, or empty if not committed.' },
    notes: { type: 'string', description: 'Anything skipped/deferred/risky; the verification result.' },
  },
}

/* ------------------------------- prompt builders ------------------------------- */

function briefBlock(brief) {
  return 'PROJECT BRIEF (read the real files under ' + PROJECT_DIR + ' to confirm — do not rely on this summary alone):\n' +
    JSON.stringify(brief, null, 2) + '\n'
}

function reviewerPrompt(persona, brief, cycle, prior) {
  return 'You are a ' + persona.title + ' at ' + COMPANY + '. ' + persona.charter + '\n\n' +
    briefBlock(brief) + '\n' +
    'You are doing the REVIEW step of improvement cycle ' + cycle + ' of ' + CYCLES + '. Open and actually read the\n' +
    'relevant files under ' + PROJECT_DIR + ' and reason about the real, rendered/run experience.\n\n' +
    (prior
      ? 'Context — what the team changed in earlier cycles:\n' + prior + '\nReview the CURRENT state. Call out anything still weak, anything half-done, and any regressions the changes introduced.'
      : 'This is the first review of the current state.') + '\n\n' +
    'Be a realistic, senior, professional reviewer — NOT sycophantic. No praise padding. Lead with what is wrong\n' +
    'or missing. Be concrete and specific (name the surface, the element, the behavior, the file). Ground every\n' +
    'finding in something really present (or absent) in the code. Judge against the bar of a product you would\n' +
    'actually ship. Scope of this engagement: ' + SCOPE + '. Cover both within your lane; prioritize issues that\n' +
    'genuinely matter; skip nitpicks. Return findings via the structured output.'
}

function leadPrompt(brief, cycle, reviews, prior) {
  const blocks = reviews.map(function (r, i) {
    return REVIEWERS[i].title.toUpperCase() + ':\n' + JSON.stringify(r, null, 2)
  }).join('\n\n')
  return 'You are an ' + LEAD.title + ' at ' + COMPANY + ', running improvement cycle ' + cycle + ' of ' + CYCLES + '. ' + LEAD.charter + '\n\n' +
    briefBlock(brief) + '\n' +
    'Senior reviewers just assessed the current state. Their findings (JSON):\n\n' + blocks + '\n\n' +
    (prior ? 'Already shipped in earlier cycles:\n' + prior + '\n\n' : '') +
    'Turn this into ONE focused, achievable milestone for a single implementation pass. Ruthlessly prioritize —\n' +
    'pick 3-6 tasks that deliver the most value this cycle, balancing the scope (' + SCOPE + '). Do NOT try to do\n' +
    'everything; defer the rest explicitly. Each task must be independently implementable within what this project\n' +
    'already is. Assign each task to the right designer by key — available designers:\n' +
    DESIGNERS.map(function (d) { return '  - ' + d.key + ': ' + d.charter }).join('\n') + '\n' +
    'Keep scope realistic for one engineer in one cycle. Avoid redoing what earlier cycles already shipped.\n' +
    'Return the milestone via the structured output.'
}

function designerPrompt(designer, brief, cycle, milestone, myTasks, prior) {
  return 'You are an ' + designer.title + ' at ' + COMPANY + '. ' + designer.charter + '\n\n' +
    briefBlock(brief) + '\n' +
    'Improvement cycle ' + cycle + ' of ' + CYCLES + '. The Delivery Lead set this milestone: "' + milestone.milestoneName + '".\n' +
    'Rationale: ' + milestone.rationale + '\n\n' +
    'You own these tasks (write a spec for EACH). Read the relevant current files under ' + PROJECT_DIR + ' first so\n' +
    'your spec fits the real code and existing conventions/design system.\n\n' +
    'YOUR TASKS:\n' + JSON.stringify(myTasks, null, 2) + '\n\n' +
    (prior ? 'Already shipped earlier:\n' + prior + '\n\n' : '') +
    'Write a precise, buildable spec per task: exact states, copy, layout, components, behavior, responsive and\n' +
    'accessibility notes, and crisp acceptance criteria. Reuse the project existing patterns/tokens — do not invent\n' +
    'a parallel system. Stay within the project existing constraints. Return via the structured output.'
}

function engineerPrompt(brief, cycle, milestone, specs, prior) {
  const commitRule = DO_COMMIT
    ? '- Then commit on the CURRENTLY CHECKED-OUT branch ONLY. Run:\n' +
      '      cd ' + PROJECT_DIR + ' && git add -A && git commit -m "Cycle ' + cycle + ': <concise summary of what shipped>"\n' +
      '    Do NOT push. Do NOT switch or create branches. Do NOT amend earlier commits. Capture the short hash (git rev-parse --short HEAD).'
    : '- Do NOT commit; leave the changes in the working tree. Set committed=false and commitHash="".'
  return 'You are an ' + ENGINEER.title + ' at ' + COMPANY + ', implementing cycle ' + cycle + ' of ' + CYCLES + '. ' + ENGINEER.charter + '\n\n' +
    briefBlock(brief) + '\n' +
    'The Delivery Lead milestone: "' + milestone.milestoneName + '" (' + milestone.rationale + ')\n\n' +
    'Designer specs to implement (JSON):\n' + JSON.stringify(specs, null, 2) + '\n\n' +
    (prior ? 'Already shipped in earlier cycles (build on it, do not redo it):\n' + prior + '\n\n' : '') +
    'Implement ALL the specs by editing the real files under ' + PROJECT_DIR + '. Rules:\n' +
    '  - Read each file before editing it. Match the existing code style and architecture. Do NOT introduce new\n' +
    '    dependencies, build tooling, or services unless a spec clearly requires it AND it is consistent with the\n' +
    '    project constraints; prefer the smallest change that satisfies the acceptance criteria.\n' +
    '  - Implement every acceptance criterion you reasonably can. If something is infeasible within constraints, do\n' +
    '    the best feasible version and note it.\n' +
    '  - Verify before committing using whatever the project supports (per the brief howToVerify: build, tests,\n' +
    '    lint, type-check, or at minimum a syntax/parse check of every file you touched). Fix what you break.\n' +
    '  ' + commitRule + '\n' +
    'Return a summary, the per-task changes, committed flag, the commit hash, and notes (including the verification\n' +
    'result) via the structured output.'
}

/* ----------------------------------- run ----------------------------------- */

// Phase 0: discover the project (unless caller supplied a brief).
phase('Discover')
let brief
if (A.appContext) {
  brief = { brief: String(A.appContext), stack: '(provided by caller)', keyFiles: [], constraints: [], howToVerify: 'Use the project standard build/test/lint; otherwise syntax-check touched files.' }
} else {
  brief = await agent(
    'You are a staff engineer onboarding to a codebase. Map the project rooted at ' + PROJECT_DIR + ': read the\n' +
    'README, manifests (package.json / pyproject / go.mod / etc.), entry points, and a representative sample of\n' +
    'source files. Produce a concise, accurate brief another engineer or designer could reason against — what it\n' +
    'is and does, the stack, the key files/dirs, the invariants to preserve, and how to verify a change in THIS\n' +
    'repo specifically. Be factual; do not guess at features that are not there.',
    { label: 'discover:project', phase: 'Discover', schema: DISCOVERY_SCHEMA, effort: 'high', agentType: 'Explore' })
}

const cycleSummaries = []
function priorContext() {
  if (!cycleSummaries.length) return ''
  return cycleSummaries.map(function (c) { return 'Cycle ' + c.cycle + ' — "' + c.milestone + '": ' + c.summary }).join('\n')
}

const allResults = []

for (let cycle = 1; cycle <= CYCLES; cycle++) {
  const prior = priorContext()

  // Review (parallel barrier — the lead needs every reviewer).
  phase('Cycle ' + cycle + ' Review')
  const reviews = (await parallel(REVIEWERS.map(function (rv) {
    return function () {
      return agent(reviewerPrompt(rv, brief, cycle, prior),
        { label: 'C' + cycle + ' review:' + rv.title, phase: 'Cycle ' + cycle + ' Review', schema: REVIEW_SCHEMA, effort: 'high' })
    }
  }))).map(function (r) { return r || { persona: 'unavailable', overallAssessment: '', findings: [] } })

  // Prioritize (single).
  phase('Cycle ' + cycle + ' Prioritize')
  const milestone = await agent(leadPrompt(brief, cycle, reviews, prior),
    { label: 'C' + cycle + ' prioritize:' + LEAD.title, phase: 'Cycle ' + cycle + ' Prioritize', schema: PRIORITIZE_SCHEMA, effort: 'high' })

  // Spec (parallel designers, barrier — the engineer needs both).
  phase('Cycle ' + cycle + ' Spec')
  const specThunks = DESIGNERS.map(function (d) {
    const myTasks = milestone.tasks.filter(function (t) { return t.assignTo === d.key })
    if (!myTasks.length) return null
    return function () {
      return agent(designerPrompt(d, brief, cycle, milestone, myTasks, prior),
        { label: 'C' + cycle + ' spec:' + d.title, phase: 'Cycle ' + cycle + ' Spec', schema: SPEC_SCHEMA, effort: 'high' })
    }
  }).filter(Boolean)
  const specResults = (await parallel(specThunks)).filter(Boolean)
  const allSpecs = specResults.flatMap(function (s) { return s.specs })

  // Implement (single; edits files + commits).
  phase('Cycle ' + cycle + ' Implement')
  const impl = await agent(engineerPrompt(brief, cycle, milestone, allSpecs, prior),
    { label: 'C' + cycle + ' implement:' + ENGINEER.title, phase: 'Cycle ' + cycle + ' Implement', schema: IMPLEMENT_SCHEMA, effort: 'high' })

  cycleSummaries.push({ cycle: cycle, milestone: milestone.milestoneName, summary: impl.summary })
  allResults.push({ cycle: cycle, reviews: reviews, milestone: milestone, specs: specResults, implementation: impl })
  log('Cycle ' + cycle + ' done — "' + milestone.milestoneName + '" — committed=' + impl.committed + ' ' + impl.commitHash)
}

// Final: write a human-readable cycle log and commit it.
if (DO_LOG) {
  phase('Document')
  const logData = JSON.stringify(allResults.map(function (r) {
    return {
      cycle: r.cycle,
      milestone: r.milestone,
      reviewVerdicts: r.reviews.map(function (rv) {
        return { persona: rv.persona, overallAssessment: rv.overallAssessment, keyFindings: (rv.findings || []).filter(function (f) { return f.severity !== 'minor' }) }
      }),
      implementation: r.implementation,
    }
  }), null, 2)
  const commitLine = DO_COMMIT
    ? 'After writing the file, commit it on the current branch: cd ' + PROJECT_DIR + ' && git add docs/improvement-cycles.md && git commit -m "Document the improvement cycles". Do NOT push.'
    : 'Do NOT commit; leave the file in the working tree.'
  await agent(
    'You are a technical writer. Write a clear Markdown log of a multi-cycle improvement effort to\n' +
    PROJECT_DIR + '/docs/improvement-cycles.md (create the docs/ dir if needed). For EACH cycle include: the\n' +
    'milestone name + rationale, each reviewer overall verdict, the key (critical/major) findings, a table of the\n' +
    'prioritized tasks (id, title, priority, category, owner, desired outcome), what was deferred, and what the\n' +
    'engineer shipped. End with an "Outcome" section summarizing the arc across all cycles. Use the structured\n' +
    'data below verbatim as your source; do not invent results.\n\n' +
    'DATA (JSON):\n' + logData + '\n\n' + commitLine + '\n' +
    'Return a one-line confirmation of the path written.',
    { label: 'document:cycle-log', phase: 'Document', effort: 'medium' })
}

return allResults
