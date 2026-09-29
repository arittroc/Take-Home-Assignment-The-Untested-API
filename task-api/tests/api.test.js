const request = require('supertest');
const app = require('../src/app');
const taskService = require('../src/services/taskService');

const iso = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString();

beforeEach(() => {
  taskService._reset();
});

describe('API integration', () => {
  describe('POST /tasks', () => {
    it('creates a task and returns 201 with the stored task', async () => {
      const res = await request(app)
        .post('/tasks')
        .send({ title: 'Write tests', priority: 'high' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ title: 'Write tests', priority: 'high', status: 'todo' });
      expect(res.body.id).toEqual(expect.any(String));
    });

    it('rejects a missing title with 400', async () => {
      const res = await request(app).post('/tasks').send({ priority: 'high' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/title/i);
    });

    it('rejects an invalid status with 400', async () => {
      const res = await request(app).post('/tasks').send({ title: 'x', status: 'archived' });

      expect(res.status).toBe(400);
    });

    it('rejects a whitespace-only title with 400', async () => {
      const res = await request(app).post('/tasks').send({ title: '   ' });

      expect(res.status).toBe(400);
    });

    it('rejects a missing JSON body with 400 (not a 500)', async () => {
      // I suspected a missing body would crash validateCreateTask (undefined
      // deref -> 500). Probing showed Express 4 initializes req.body to {}
      // when it skips parsing, so the validator cleanly returns 400.
      // Documented as a surprising non-bug in BUG_REPORT.md.
      const res = await request(app).post('/tasks').send();

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/title/i);
    });

    it('persists the task so a later GET returns it', async () => {
      const created = await request(app).post('/tasks').send({ title: 'durable' });
      const listed = await request(app).get('/tasks');

      expect(listed.body.map((t) => t.id)).toContain(created.body.id);
    });
  });

  describe('GET /tasks', () => {
    it('returns all tasks', async () => {
      taskService.create({ title: 'a' });
      taskService.create({ title: 'b' });

      const res = await request(app).get('/tasks');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it('returns an empty array when the store is empty', async () => {
      const res = await request(app).get('/tasks');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('filters by status', async () => {
      taskService.create({ title: 'a', status: 'in_progress' });
      taskService.create({ title: 'b' });

      const res = await request(app).get('/tasks?status=in_progress');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe('a');
    });

    it('documents that status filtering is substring-based today (desired exact-match pinned as BUG-02)', async () => {
      // Characterization of today's behavior: 'don' matches 'done'. The failing
      // repro for exact matching lives in tests/known-bugs.test.js.
      taskService.create({ title: 'a', status: 'done' });

      const res = await request(app).get('/tasks?status=don');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it('BUG-01 (fixed): ?page=1 now returns the first page instead of skipping it', async () => {
      for (const t of ['a', 'b', 'c', 'd', 'e']) taskService.create({ title: t });

      const res = await request(app).get('/tasks?page=1&limit=2');

      expect(res.body.map((t) => t.title)).toEqual(['a', 'b']);
    });

    it('returns a later page', async () => {
      for (const t of ['a', 'b', 'c']) taskService.create({ title: t });

      const res = await request(app).get('/tasks?page=2&limit=2');

      expect(res.body.map((t) => t.title)).toEqual(['c']);
    });

    it('defaults to limit 10 when only ?page is given', async () => {
      for (let i = 0; i < 12; i++) taskService.create({ title: `t${i}` });

      const res = await request(app).get('/tasks?page=1');

      expect(res.body).toHaveLength(10);
    });

    it('returns an empty list for a page beyond the data', async () => {
      taskService.create({ title: 'a' });

      const res = await request(app).get('/tasks?page=99&limit=10');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('treats non-numeric page/limit as their defaults', async () => {
      for (let i = 0; i < 3; i++) taskService.create({ title: `t${i}` });

      const res = await request(app).get('/tasks?page=abc&limit=2');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });
  });

  describe('PUT /tasks/:id', () => {
    it('updates an existing task and returns it', async () => {
      const task = taskService.create({ title: 'before' });

      const res = await request(app)
        .put(`/tasks/${task.id}`)
        .send({ title: 'after', priority: 'high' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ title: 'after', priority: 'high' });
    });

    it('keeps unspecified fields unchanged (full object semantics still preserve the rest)', async () => {
      const task = taskService.create({ title: 'keep me', description: 'desc' });

      const res = await request(app).put(`/tasks/${task.id}`).send({ title: 'renamed' });

      expect(res.body.description).toBe('desc');
    });

    it('returns 404 for an unknown id', async () => {
      const res = await request(app).put('/tasks/no-such-id').send({ title: 'x' });

      expect(res.status).toBe(404);
    });

    it('rejects an invalid payload with 400 without touching the task', async () => {
      const task = taskService.create({ title: 'untouched' });

      const res = await request(app).put(`/tasks/${task.id}`).send({ title: '' });

      expect(res.status).toBe(400);
      expect(taskService.findById(task.id).title).toBe('untouched');
    });
  });

  describe('DELETE /tasks/:id', () => {
    it('deletes an existing task and returns 204 with no body', async () => {
      const task = taskService.create({ title: 'bye' });

      const res = await request(app).delete(`/tasks/${task.id}`);

      expect(res.status).toBe(204);
      expect(res.text).toBe('');
      expect(taskService.findById(task.id)).toBeUndefined();
    });

    it('returns 404 for an unknown id', async () => {
      const res = await request(app).delete('/tasks/no-such-id');

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /tasks/:id/complete', () => {
    it('marks a task as done and stamps completedAt', async () => {
      const task = taskService.create({ title: 'finish me' });

      const res = await request(app).patch(`/tasks/${task.id}/complete`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('done');
      expect(res.body.completedAt).toEqual(expect.any(String));
      expect(taskService.findById(task.id).status).toBe('done');
    });

    it('currently resets priority to medium on completion (desired preserve pinned as BUG-04)', async () => {
      // Characterization of today's behavior. The failing repro for preserving
      // priority lives in tests/known-bugs.test.js.
      const task = taskService.create({ title: 'urgent', priority: 'high' });

      const res = await request(app).patch(`/tasks/${task.id}/complete`);

      expect(res.body.priority).toBe('medium');
    });

    it('returns 404 for an unknown id', async () => {
      const res = await request(app).patch('/tasks/no-such-id/complete');

      expect(res.status).toBe(404);
    });

    it('drops a done task out of the overdue count', async () => {
      const task = taskService.create({ title: 'late', dueDate: iso(-5) });
      expect((await request(app).get('/tasks/stats')).body.overdue).toBe(1);

      await request(app).patch(`/tasks/${task.id}/complete`);

      expect((await request(app).get('/tasks/stats')).body.overdue).toBe(0);
    });
  });

  describe('GET /tasks/stats', () => {
    it('returns counts by status plus overdue for a mixed store', async () => {
      taskService.create({ title: 'a' });
      taskService.create({ title: 'b', status: 'in_progress' });
      taskService.create({ title: 'c', status: 'done' });
      taskService.create({ title: 'late', dueDate: iso(-1) });
      taskService.create({ title: 'future', dueDate: iso(3) });
      const res = await request(app).get('/tasks/stats');

      expect(res.status).toBe(200);
      // 2 default-status todos ('a' and 'late') + 'in_progress' + 'done' +
      // 'future' (also defaults to todo) = 3 todo.
      expect(res.body).toEqual({ todo: 3, in_progress: 1, done: 1, overdue: 1 });
    });

    it('returns zeros when the store is empty', async () => {
      const res = await request(app).get('/tasks/stats');

      expect(res.body).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
    });
  });

  describe('unknown routes', () => {
    it('returns 404 for an undefined path', async () => {
      const res = await request(app).get('/definitely-not-a-route');

      expect(res.status).toBe(404);
    });

    it('currently answers malformed JSON with 500 (a client error) — noted in BUG_REPORT.md', async () => {
      // The global error handler treats every thrown error, including
      // express.json() parse errors, as an internal server error. A 400 would
      // be correct; characterized here as-is and reported as a minor bug.
      const res = await request(app)
        .post('/tasks')
        .set('Content-Type', 'application/json')
        .send('{not valid json');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
    });
  });

  // NEW (Part C): PATCH /tasks/:id/assign
  describe('PATCH /tasks/:id/assign', () => {
    it('assigns a task to a user and returns the updated task', async () => {
      const task = taskService.create({ title: 'who does this?' });

      const res = await request(app)
        .patch(`/tasks/${task.id}/assign`)
        .send({ assignee: 'Ravi' });

      expect(res.status).toBe(200);
      expect(res.body.assignee).toBe('Ravi');
      expect(taskService.findById(task.id).assignee).toBe('Ravi');
    });

    it('returns 404 when the task does not exist', async () => {
      const res = await request(app)
        .patch('/tasks/no-such-id/assign')
        .send({ assignee: 'Ravi' });

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it('allows reassigning to a different user (idempotent update, not an error)', async () => {
      const task = taskService.create({ title: 'handover' });
      await request(app).patch(`/tasks/${task.id}/assign`).send({ assignee: 'Ravi' });

      const res = await request(app)
        .patch(`/tasks/${task.id}/assign`)
        .send({ assignee: 'Priya' });

      expect(res.status).toBe(200);
      expect(res.body.assignee).toBe('Priya');
    });

    it('rejects a missing assignee with 400', async () => {
      const task = taskService.create({ title: 'a' });

      const res = await request(app).patch(`/tasks/${task.id}/assign`).send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/assignee/i);
      expect(taskService.findById(task.id).assignee).toBeUndefined();
    });

    it('rejects an empty-string assignee with 400', async () => {
      const task = taskService.create({ title: 'a' });

      const res = await request(app)
        .patch(`/tasks/${task.id}/assign`)
        .send({ assignee: '' });

      expect(res.status).toBe(400);
      expect(taskService.findById(task.id).assignee).toBeUndefined();
    });

    it('rejects a whitespace-only assignee with 400', async () => {
      const task = taskService.create({ title: 'a' });

      const res = await request(app)
        .patch(`/tasks/${task.id}/assign`)
        .send({ assignee: '   ' });

      expect(res.status).toBe(400);
    });

    it('rejects a non-string assignee with 400', async () => {
      const task = taskService.create({ title: 'a' });

      const res = await request(app)
        .patch(`/tasks/${task.id}/assign`)
        .send({ assignee: 42 });

      expect(res.status).toBe(400);
    });

    it('allows unassigning with explicit null', async () => {
      const task = taskService.create({ title: 'handover' });
      await request(app).patch(`/tasks/${task.id}/assign`).send({ assignee: 'Ravi' });

      const res = await request(app)
        .patch(`/tasks/${task.id}/assign`)
        .send({ assignee: null });

      expect(res.status).toBe(200);
      expect(res.body.assignee).toBeNull();
    });

    it('does not let assign be used to smuggle other fields', async () => {
      const task = taskService.create({ title: 'a', priority: 'low' });

      const res = await request(app)
        .patch(`/tasks/${task.id}/assign`)
        .send({ assignee: 'Ravi', priority: 'high', status: 'done' });

      expect(res.status).toBe(200);
      expect(res.body.priority).toBe('low');
      expect(res.body.status).toBe('todo');
    });
  });
});
