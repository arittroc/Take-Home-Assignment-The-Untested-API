const { validateCreateTask, validateUpdateTask } = require('../src/utils/validators');

describe('validators (unit)', () => {
  describe('validateCreateTask', () => {
    it('accepts a minimal valid body', () => {
      expect(validateCreateTask({ title: 'Write tests' })).toBeNull();
    });

    it('accepts a fully specified valid body', () => {
      const body = {
        title: 'Write tests',
        status: 'in_progress',
        priority: 'high',
        dueDate: '2026-12-31T00:00:00.000Z',
      };
      expect(validateCreateTask(body)).toBeNull();
    });

    it.each([
      ['a missing title', {}],
      ['an empty title', { title: '' }],
      ['a whitespace-only title', { title: '   ' }],
      ['a non-string title', { title: 42 }],
      ['an unknown status', { title: 'a', status: 'archived' }],
      ['an unknown priority', { title: 'a', priority: 'urgent' }],
      ['an invalid dueDate', { title: 'a', dueDate: 'not a date' }],
    ])('rejects %s', (_name, body) => {
      expect(typeof validateCreateTask(body)).toBe('string');
    });

    // NOTE: I initially suspected an undefined body would crash
    // `!body.title` and surface as a 500 via POST /tasks. Probing showed
    // Express 4 initializes req.body to {} when it skips parsing, so this is
    // a non-bug — see the "surprising non-bug" note in BUG_REPORT.md.
  });

  describe('validateUpdateTask', () => {
    it('accepts an empty body (nothing to validate)', () => {
      expect(validateUpdateTask({})).toBeNull();
    });

    it('accepts valid partial fields, including dueDate null', () => {
      expect(validateUpdateTask({ title: 'y', priority: 'low', dueDate: null })).toBeNull();
    });

    it.each([
      ['an empty-string title', { title: '' }],
      ['a non-string title', { title: [] }],
      ['an unknown status', { status: 'x' }],
      ['an unknown priority', { priority: 'x' }],
      ['an invalid dueDate', { dueDate: 'x' }],
    ])('rejects %s', (_name, body) => {
      expect(typeof validateUpdateTask(body)).toBe('string');
    });
  });
});
