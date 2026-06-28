# Reusable workflows

## `improvement-cycles`

A project-agnostic, multi-agent improvement pipeline. Runs N serial cycles of
**review → prioritize → delegate & specialize → implement**, where each cycle reviews the
*actual committed result* of the previous one — so regressions and half-finished work get caught
like a real delivery cadence.

### Personas
- **Reviewers** (realistic, senior, *not* sycophantic) — default: a Senior Product Manager and a
  Senior Design/Art Director.
- **Expert Delivery Lead** — turns findings into one focused, ruthlessly-prioritized milestone and
  assigns each task.
- **Designers** — default: a System Experience Designer (flows/states/data/edge cases) and a
  UI/UX Specialist (visual/interaction polish) — draft buildable specs.
- **Expert Software Engineer** — implements the specs, verifies, and commits each cycle.

A discovery agent maps the repo first, so it works on any stack without hand-written context.

### Run it
From inside the target project (check out the branch you want commits on first):

```
Workflow({ name: 'improvement-cycles' })                      # defaults: 4 cycles
Workflow({ name: 'improvement-cycles', args: { cycles: 3 } })
```

Or just ask Claude: *"run the improvement-cycles workflow for 4 cycles."*

### Options (`args`)
| key | default | meaning |
|-----|---------|---------|
| `cycles` | `4` | number of cycles (1–8) |
| `scope` | `functionality AND user interface polish` | what to improve |
| `companyContext` | `an established company shipping a live product` | framing for the personas (e.g. `a live games company`) |
| `appContext` | *(auto-discovered)* | hand-written project brief; skips the discovery agent if set |
| `projectDir` | `.` | repo root |
| `commit` | `true` | engineer commits each cycle (on the current branch; never switches branches) |
| `writeLog` | `true` | final agent writes `docs/improvement-cycles.md` |
| `personas` | built-in defaults | override `reviewers[]`, `lead`, `designers[]`, `engineer` |

### Reuse on other projects
- **This repo:** it's committed under `.claude/workflows/`, so it's available whenever you work here.
- **Everywhere:** copy `improvement-cycles.js` into another project's `.claude/workflows/`, or into
  your user-level `~/.claude/workflows/` to make it available in every project.

### Notes
- The engineer commits on the **currently checked-out branch** and never switches branches — check
  out your feature branch before running. It does not push; you review and push.
- It won't add new dependencies or build tooling unless a spec clearly requires it and it's
  consistent with the project's constraints.
