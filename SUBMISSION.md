# Submission — The Untested API

## What's here

| Deliverable | Where |
|---|---|
| Unit + integration tests (85 tests) | `task-api/tests/` |
| Coverage (98.7% stmts / 97.8% branch — target was 80%) | `npm run coverage` |
| Bug report (6 bugs + 2 honest non-bugs) | `BUG_REPORT.md` |
| One bug fixed | BUG-01, pagination off-by-one, in `src/services/taskService.js` |
| New endpoint `PATCH /tasks/:id/assign` | `src/routes/tasks.js`, `src/services/taskService.js`, `src/utils/validators.js` + 9 tests |

## How to verify

```bash
cd task-api
npm install
npm test            # 85 passing — including 5 "expected failure" repros (see below)
npm run coverage
npm start           # then try the endpoint below
```

```bash
curl -X PATCH http://localhost:3000/tasks/<id>/assign \
  -H "Content-Type: application/json" \
  -d '{"assignee": "Ravi"}'
```

## Design decisions on `PATCH /tasks/:id/assign`

- **Validation:** `assignee` must be a non-empty (after trim) string. Missing,
  empty, whitespace-only, and non-string values all return `400`.
- **Empty string vs null:** `""` is rejected as a likely typo, while `null` is
  accepted and means "unassign" — the two are deliberately different, and the rule
  is documented in `validators.js`.
- **Reassignment:** assigning over an existing assignee is allowed and idempotent
  (returns the task, not an error). Realistic and convenient; can be tightened
  later without breaking clients.
- **Unknown task → 404**, checked in the service like every other id-based route.
- **No field smuggling:** only `assignee` is written; a body containing other keys
  (e.g. `status`, `priority`) cannot mutate them.
- **Shape:** `assignee` sits at the top level of the task JSON, is absent until
  first assigned, and `null` after explicit unassign.

## One note on the test suite

`tests/known-bugs.test.js` holds `it.failing` repros for the 5 bugs I reported but
did not fix. They demonstrate each bug is real; Jest reports them as expected
failures, so `npm test` stays green. When a bug is fixed, its repro turns green
too — remove `.failing` and promote it into the regular suite, exactly as was done
for the fixed pagination bug.

## The short answers the brief asks for

**What I'd test next:** concurrency (simultaneous writes to the same task, double
completion), pagination bounds (`limit=0`, negatives, huge values), strictness of
`dueDate` parsing, and the `completedAt` ↔ `status` invariant after mixed
`PUT`/`PATCH` sequences.

**What surprised me:** Express 4 pre-initializes `req.body` to `{}` (my strongest
crash theory dissolved when probed); the `?status=don` substring filter returns
plausible data instead of an error, which is far more dangerous than a crash; and
the service leaks live references to stored tasks — invisible over HTTP because
`res.json` serializes, but a real trap for any in-process consumer. Full story in
`BUG_REPORT.md`.

**Questions before production:** which status vocabulary is canonical —
`README.md` says `pending|in-progress|completed`, `ASSIGNMENT.md` and the code say
`todo|in_progress|done`; what durability is expected from an in-memory store; is
`assignee` free text or a reference to validate against a user service; and do
existing clients depend on the current (broken) pagination behavior?
