# Bug Report — Task Manager API

Test results reviewed after writing the Day 1 suites (`tests/`). Bugs are listed by
severity. For each: expected vs actual, how I found it, where it lives, and what a
fix looks like. The pinned repros live in `tests/known-bugs.test.js` as
`it.failing` — they fail against the buggy code (proving each bug) and turn green
the moment each is fixed.

---

## BUG-01 (fixed): Pagination skips the first page

- **Where:** `src/services/taskService.js` → `getPaginated`
- **Expected:** `GET /tasks?page=1&limit=10` returns the first 10 tasks (page is 1-based).
- **Actual:** `offset = page * limit` makes page 1 start at index 10 — it returns the
  *second* window. Page 1 of a 25-task list shows tasks 11–20; the first 10 are
  unreachable. Any client using the documented pagination silently misses data.
- **How I discovered it:** the very first integration test I wrote ("page 1 returns
  the first window") failed, returning `['c','d']` for `page=1&limit=2` of
  `a,b,c,d`. Not guessed from reading — the test caught it.
- **Fix applied:** `const offset = (page - 1) * limit;`. The repro was promoted into
  the regular suites (`tests/api.test.js`, `tests/taskService.test.js`) as passing
  tests. A fuller fix would also return total count / page metadata, but that
  changes the response shape, so I left the contract as-is.

## BUG-02: Status filter matches substrings, not values

- **Where:** `src/services/taskService.js` → `getByStatus`
  (`tasks.filter((t) => t.status.includes(status))`)
- **Expected:** `?status=don` matches nothing (or is rejected as invalid — see BUG-03).
- **Actual:** `String.includes` makes `don` match `done`, `to` match `todo`, etc.
  A typo'd filter returns plausible-looking data with no error, which is worse than
  an empty result: callers can't tell success from a typo.
- **How I discovered it:** my substring-filter characterization test matched on the
  first run; asserting the *desired* behavior (`?status=don` → `[]`) failed.
- **Fix:** compare equality (`t.status === status`), ideally rejecting unknown
  status values per BUG-03.

## BUG-03: Invalid `status` filter silently returns an empty 200

- **Where:** `src/routes/tasks.js` → `GET /` (status branch)
- **Expected:** `GET /tasks?status=garbage` → `400` with an error message, mirroring
  how POST/PUT validate `status` against the same allowlist.
- **Actual:** the value flows into `getByStatus` and returns `200 []`. Two different
  validation standards for the same field, and a silent-empty response invites
  clients to ship the bug.
- **How I discovered it:** writing filter edge cases; the desired-behavior repro in
  `tests/known-bugs.test.js` fails today.
- **Fix:** validate `status` against `VALID_STATUSES` in the route before calling
  the service; return `400` otherwise.

## BUG-04: Completing a task resets its priority to medium

- **Where:** `src/services/taskService.js` → `completeTask`
  (`priority: 'medium'` in the spread)
- **Expected:** completion changes `status` → `done` and stamps `completedAt`;
  unrelated fields are untouched.
- **Actual:** any task's priority is overwritten to `medium` on completion — a high
  priority task loses its priority, and the field's meaning ("how urgent is this")
  is corrupted by an unrelated action. Smells like copy-paste from a
  "normalize fields" snippet.
- **How I discovered it:** the integration test "completing preserves priority"
  (asserting `high` survives) failed; the current behavior is characterized in the
  passing suite.
- **Fix:** drop the `priority: 'medium'` line from the spread.

## BUG-05: `update()` performs mass assignment (id/createdAt can be overwritten)

- **Where:** `src/services/taskService.js` → `update` (spread of arbitrary fields),
  reached via `PUT /tasks/:id`
- **Expected:** identity and audit fields (`id`, `createdAt`) are immutable after
  creation.
- **Actual:** `PUT /tasks/:id {"id": "...", "createdAt": "1999-...", "title": "x"}`
  overwrites both. `id` hijacking breaks references from anything that stored the
  old id; `createdAt` rewriting corrupts audit data. Note the contrast: `create()`
  destructures only known fields, so it is safe — `update()` simply lacks the same
  guard.
- **How I discovered it:** reading `update()` alongside the safe `create()`; the
  repro in `tests/known-bugs.test.js` confirms it end-to-end through the route.
- **Fix:** allowlist the updatable fields, e.g. destructure
  `{ title, description, status, priority, dueDate }` and spread only those.

## BUG-06 (minor): Service returns live references to stored tasks

- **Where:** `src/services/taskService.js` — `create` returns the stored object;
  `findById` returns the stored object; `getAll` shallow-copies the array only.
- **Expected:** consumers can mutate what they're given without corrupting the store.
- **Actual:** `const t = service.findById(id); t.title = 'x'` silently mutates the
  stored task. Over HTTP this is masked — `res.json` stringifies, so clients can
  never alias the store — which is exactly why it hides until a second in-process
  consumer (job, script, another route) touches the service directly.
- **How I discovered it:** my "getAll returns a defensive copy" test failed; the
  HTTP-level repro *passed* and initially fooled me into thinking the bug was
  only in my test — the JSON serialization mask was the actual explanation.
- **Fix:** return a clone (`{ ...task }`) from `create`, `findById`, `update`,
  `completeTask`, `assignTask` (elements of `getAll` then also become copies), or
  `structuredClone` for deep safety.

## Reported but not counted as bugs (honest non-bugs)

- **"POST with no body returns 500"** — my initial hypothesis. `validateCreateTask`
  would crash on `undefined` (a 500 via the error handler), but probing showed
  Express 4 initializes `req.body` to `{}` when it skips parsing, so the endpoint
  cleanly returns `400`. I probed four body variants before writing this report
  rather than reporting a plausible-but-false bug.
- **"completedAt reuses a stale value"** — I misread the spread order in
  `completeTask`; the explicit `completedAt: new Date()...` key wins. The repro
  failed in the wrong direction, so I dropped it.

## Also observed (minor, not in the numbered list)

- **Malformed JSON → 500.** The global error handler in `src/app.js` maps *every*
  thrown error — including `express.json()` parse errors — to
  `500 Internal server error`. A malformed body is a client error (`400`). Also
  logs the stack server-side, which is fine, but the status class is wrong.
  Characterized by a test in `tests/api.test.js`.

---

## Notes for the reviewer

### The fix I shipped (Part B)
BUG-01, pagination: one-line offset change, two promoted tests
(`?page=1` returns the first window at both the service and API level; later pages
and out-of-range pages still verified). Chose it because it's a silent data-loss
bug, the fix is minimal and provable, and it doesn't change any response contract.

### What surprised me
1. Express 4 pre-initializing `req.body` to `{}` — it converted my best "crash"
   theory into a non-bug, and it means the empty-body hazard only exists for
   callers using the service directly.
2. The `?status=don` substring filter — wrongness that returns *plausible* data is
   much more dangerous than a crash, because nothing surfaces it.
3. How easy it was to fool myself twice (the completedAt misread, and the HTTP
   repro "passing" on BUG-06). Writing the repro before concluding anything saved
   the report from two false claims.

### What I'd test next with more time
1. **Concurrency/races:** simultaneous `PUT` + `DELETE` on the same id, and
   duplicate `PATCH /complete` calls (double `completedAt` stamps — the second
   overwrites the first; is that acceptable?).
2. **Bound limits:** `limit=0`, huge `limit`, negative `page` — `slice` semantics
   make some of these silently weird rather than erroring.
3. **`Date.parse` looseness:** the validator accepts non-ISO strings like
   `"March 5, 2026"`; decide whether `dueDate` must be strict ISO 8601 and pin it.
4. **`completedAt` consistency:** completing a task, then `PUT`-ing
   `status: "todo"` leaves `completedAt` set with `status: todo` — invariant
   tests around status ↔ completedAt would catch the whole family.
5. **Persistence & restart behavior** if the store ever leaves memory, plus a
   rate/abuse pass (unbounded task creation) before any real deployment.

### Questions I'd ask before shipping to production
1. Is the 2-value status vocabulary in `ASSIGNMENT.md` (`todo|in_progress|done`)
   canonical, or is `README.md` (`pending|in-progress|completed`) the newer spec?
   The code follows `ASSIGNMENT.md`; a mismatch this fundamental needs an owner.
2. Who consumes the API today, and is the pagination contract (`page` 1-based, no
   total count) something clients already depend on?
3. What's the durability expectation for an in-memory store — is restart-wipes-
   everything actually acceptable for launch?
4. Is `assignee` meant to be free text or a user reference (id/email) that should
   be validated against a user service?
