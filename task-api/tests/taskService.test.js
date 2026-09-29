const service = require('../src/services/taskService');

const iso = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString();

beforeEach(() => {
  service._reset();
});

describe('taskService (unit)', () => {
  describe('create', () => {
    it('creates a task with sensible defaults for the optional fields', () => {
      const task = service.create({ title: 'Write tests' });

      expect(task).toMatchObject({
        title: 'Write tests',
        description: '',
        status: 'todo',
        priority: 'medium',
        dueDate: null,
        completedAt: null,
      });
      expect(task.id).toEqual(expect.any(String));
      expect(task.id).toHaveLength(36); // uuid v4
      expect(() => new Date(task.createdAt).toISOString()).not.toThrow();
    });

    it('honors explicitly provided optional fields', () => {
      const due = iso(7);
      const task = service.create({
        title: 'Ship it',
        description: 'final pass',
        status: 'in_progress',
        priority: 'high',
        dueDate: due,
      });

      expect(task).toMatchObject({
        description: 'final pass',
        status: 'in_progress',
        priority: 'high',
        dueDate: due,
      });
    });

    it('generates a unique id per task', () => {
      const a = service.create({ title: 'a' });
      const b = service.create({ title: 'b' });
      expect(a.id).not.toBe(b.id);
    });

    it('ignores caller-supplied id/createdAt/completedAt instead of storing them', () => {
      // create() destructures only known fields — a nice guard that update()
      // lacks (see BUG-05 in BUG_REPORT.md).
      const task = service.create({
        title: 'a',
        id: 'chosen-by-caller',
        createdAt: '1999-01-01T00:00:00.000Z',
        completedAt: '1999-01-01T00:00:00.000Z',
      });
      expect(task.id).not.toBe('chosen-by-caller');
      expect(task.createdAt).not.toBe('1999-01-01T00:00:00.000Z');
      expect(task.completedAt).toBeNull();
    });

    it('persists the task in the store', () => {
      service.create({ title: 'a' });
      expect(service.getAll()).toHaveLength(1);
    });
  });

  describe('getAll', () => {
    it('returns every task', () => {
      service.create({ title: 'a' });
      service.create({ title: 'b' });
      expect(service.getAll()).toHaveLength(2);
    });

    it('documents that list elements are live references today (reference-leak risk pinned as BUG-06)', () => {
      // Characterization: getAll() shallow-copies the array, but the task
      // objects inside are the stored ones — mutating them corrupts the store.
      // The failing repro for defensive copying lives in tests/known-bugs.test.js.
      service.create({ title: 'original' });
      const list = service.getAll();
      list[0].title = 'mutated';

      expect(service.getAll()[0].title).toBe('mutated');
    });
  });

  describe('findById', () => {
    it('returns the task when it exists', () => {
      const task = service.create({ title: 'a' });
      expect(service.findById(task.id)).toMatchObject({ title: 'a' });
    });

    it('returns undefined for an unknown id', () => {
      expect(service.findById('nope')).toBeUndefined();
    });
  });

  describe('getByStatus', () => {
    it('returns tasks whose status matches', () => {
      const inProgress = service.create({ title: 'a', status: 'in_progress' });
      service.create({ title: 'b' });
      service.create({ title: 'c', status: 'done' });

      expect(service.getByStatus('in_progress').map((t) => t.id)).toEqual([inProgress.id]);
    });

    it('documents the current matcher is substring-based (BUG-02, see BUG_REPORT.md)', () => {
      // Characterization test: 'don' is a substring of 'done', so today this
      // matches. The failing repro for the *desired* behavior lives in
      // tests/known-bugs.test.js.
      const done = service.create({ title: 'a', status: 'done' });
      expect(service.getByStatus('don').map((t) => t.id)).toEqual([done.id]);
    });
  });

  describe('getPaginated', () => {
    it('treats page as 1-based: page 1 returns the first window of tasks', () => {
      // BUG-01 (fixed): the original code computed offset = page * limit,
      // which made page 1 return the *second* window.
      const a = service.create({ title: 'a' });
      const b = service.create({ title: 'b' });
      service.create({ title: 'c' });

      expect(service.getPaginated(1, 2).map((t) => t.id)).toEqual([a.id, b.id]);
    });

    it('returns the requested later page', () => {
      service.create({ title: 'a' });
      service.create({ title: 'b' });
      service.create({ title: 'c' });
      const d = service.create({ title: 'd' });

      expect(service.getPaginated(2, 3).map((t) => t.id)).toEqual([d.id]);
    });

    it('returns an empty list for pages beyond the data', () => {
      service.create({ title: 'a' });
      expect(service.getPaginated(99, 10)).toEqual([]);
    });
  });

  describe('getStats', () => {
    it('returns zeroed counts for an empty store', () => {
      expect(service.getStats()).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
    });

    it('counts tasks by status', () => {
      service.create({ title: 'a' });
      service.create({ title: 'b', status: 'in_progress' });
      service.create({ title: 'c', status: 'done' });
      service.create({ title: 'd', status: 'done' });

      expect(service.getStats()).toMatchObject({ todo: 1, in_progress: 1, done: 2 });
    });

    it('counts tasks with a past dueDate that are not done as overdue', () => {
      service.create({ title: 'late', dueDate: iso(-1) });
      service.create({ title: 'soon', dueDate: iso(1) });

      expect(service.getStats().overdue).toBe(1);
    });

    it('does not count done tasks as overdue even if their dueDate has passed', () => {
      const task = service.create({ title: 'late', dueDate: iso(-1) });
      service.completeTask(task.id);

      expect(service.getStats()).toMatchObject({ done: 1, overdue: 0 });
    });

    it('treats a dueDate of exactly now as not overdue (boundary)', () => {
      service.create({ title: 'edge', dueDate: new Date().toISOString() });
      expect(service.getStats().overdue).toBe(0);
    });

    it('ignores tasks with statuses outside its known set (create does not validate status)', () => {
      // The service layer trusts the route validator; calling create directly
      // with a bogus status shows stats silently skips it rather than crashing.
      service.create({ title: 'weird', status: 'archived' });

      expect(service.getStats()).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
    });
  });

  describe('update', () => {
    it('overwrites only the provided fields and returns the updated task', () => {
      const task = service.create({ title: 'before', priority: 'low' });

      const updated = service.update(task.id, { title: 'after' });

      expect(updated).toMatchObject({ title: 'after', priority: 'low', status: 'todo' });
      expect(service.findById(task.id).title).toBe('after');
    });

    it('returns null when no task matches the id', () => {
      expect(service.update('no-such-id', { title: 'ghost' })).toBeNull();
    });

    // NOTE: update() also has a mass-assignment hole (arbitrary fields, including
    // id/createdAt, get spread onto the task) — repro pinned as BUG-05 in
    // tests/known-bugs.test.js rather than asserted as correct behavior here.
  });

  describe('remove', () => {
    it('deletes a task and reports success', () => {
      const task = service.create({ title: 'a' });

      expect(service.remove(task.id)).toBe(true);
      expect(service.findById(task.id)).toBeUndefined();
      expect(service.getAll()).toHaveLength(0);
    });

    it('reports failure for an unknown id', () => {
      expect(service.remove('nope')).toBe(false);
    });
  });

  describe('completeTask', () => {
    it('marks the task as done and stamps completedAt', () => {
      const task = service.create({ title: 'a' });

      const completed = service.completeTask(task.id);

      expect(completed.status).toBe('done');
      expect(completed.completedAt).toEqual(expect.any(String));
    });

    // NOTE: completeTask() also resets priority to 'medium' — repro pinned as
    // BUG-04 in tests/known-bugs.test.js rather than asserted as correct here.

    it('returns null for an unknown id', () => {
      expect(service.completeTask('nope')).toBeNull();
    });
  });
});
