/**
 * Known-bug repros — intentionally failing.
 *
 * These tests document BUG-02..BUG-06 from BUG_REPORT.md and pin the *desired*
 * behavior, so they fail against the original code (Jest reports them as
 * "failing" without breaking the run, thanks to it.failing).
 *
 * They exist to prove each bug is real and reproducible. BUG-01 (pagination)
 * is fixed in this submission and has been promoted into the regular suites
 * (taskService.test.js / api.test.js) as passing tests.
 */
const request = require('supertest');
const app = require('../src/app');
const taskService = require('../src/services/taskService');
const service = require('../src/services/taskService');

const iso = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString();

beforeEach(() => {
  taskService._reset();
});

describe('known bugs (failing repros — see BUG_REPORT.md)', () => {
  it.failing('BUG-02: GET /tasks?status=don should not match tasks with status "done"', async () => {
    taskService.create({ title: 'a', status: 'done' });

    const res = await request(app).get('/tasks?status=don');

    expect(res.body).toEqual([]);
  });

  it.failing('BUG-03: GET /tasks?status=garbage should 400 instead of returning an empty 200', async () => {
    taskService.create({ title: 'a' });

    const res = await request(app).get('/tasks?status=garbage');

    expect(res.status).toBe(400);
  });

  it.failing('BUG-04: PATCH /tasks/:id/complete should not reset priority to medium', async () => {
    const task = taskService.create({ title: 'a', priority: 'high' });

    const res = await request(app).patch(`/tasks/${task.id}/complete`);

    expect(res.body.priority).toBe('high');
  });

  it.failing('BUG-05: PUT /tasks/:id should ignore attempts to overwrite id/createdAt', async () => {
    const task = taskService.create({ title: 'a' });

    const res = await request(app).put(`/tasks/${task.id}`).send({
      id: 'hijacked',
      createdAt: '1999-01-01T00:00:00.000Z',
      title: 'renamed',
    });

    expect(res.body.id).toBe(task.id);
    expect(res.body.createdAt).not.toBe('1999-01-01T00:00:00.000Z');
  });

  it.failing('BUG-06: the task returned by findById is a live reference — mutating it corrupts the store', () => {
    service.create({ title: 'original' });

    // Direct service consumers get the live stored object back, so an
    // accidental mutation "sticks" with no error. (Over HTTP this is masked:
    // res.json stringifies, so clients can never alias the store — which is
    // exactly why this hides until someone consumes the service in-process.)
    const task = service.findById(service.getAll()[0].id);
    task.title = 'mutated';

    expect(service.getAll()[0].title).toBe('original');
  });
});
