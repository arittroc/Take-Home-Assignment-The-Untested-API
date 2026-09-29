const VALID_STATUSES = ['todo', 'in_progress', 'done'];
const VALID_PRIORITIES = ['low', 'medium', 'high'];

const validateCreateTask = (body) => {
  if (!body.title || typeof body.title !== 'string' || body.title.trim() === '') {
    return 'title is required and must be a non-empty string';
  }
  if (body.status && !VALID_STATUSES.includes(body.status)) {
    return `status must be one of: ${VALID_STATUSES.join(', ')}`;
  }
  if (body.priority && !VALID_PRIORITIES.includes(body.priority)) {
    return `priority must be one of: ${VALID_PRIORITIES.join(', ')}`;
  }
  if (body.dueDate && isNaN(Date.parse(body.dueDate))) {
    return 'dueDate must be a valid ISO date string';
  }
  return null;
};

const validateUpdateTask = (body) => {
  if (body.title !== undefined && (typeof body.title !== 'string' || body.title.trim() === '')) {
    return 'title must be a non-empty string';
  }
  if (body.status && !VALID_STATUSES.includes(body.status)) {
    return `status must be one of: ${VALID_STATUSES.join(', ')}`;
  }
  if (body.priority && !VALID_PRIORITIES.includes(body.priority)) {
    return `priority must be one of: ${VALID_PRIORITIES.join(', ')}`;
  }
  if (body.dueDate && isNaN(Date.parse(body.dueDate))) {
    return 'dueDate must be a valid ISO date string';
  }
  return null;
};

// NEW (PATCH /tasks/:id/assign): assignee rules.
// - string, non-empty after trim -> valid
// - undefined -> invalid (the field must be sent explicitly)
// - null     -> valid, means "unassign"
// - '' or whitespace-only -> invalid (ambiguous: a blank name is a typo, not
//   an intent to unassign; use null for that)
const validateAssignee = (assignee) => {
  if (assignee === null) return null;
  if (assignee === undefined || typeof assignee !== 'string' || assignee.trim() === '') {
    return 'assignee must be a non-empty string (or null to unassign)';
  }
  return null;
};

module.exports = { validateCreateTask, validateUpdateTask, validateAssignee };
