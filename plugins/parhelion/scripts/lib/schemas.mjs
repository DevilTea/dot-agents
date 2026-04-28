export const TASK_PHASES = new Set(['clarify', 'plan', 'execute', 'review']);

export const TASK_STATUSES = new Set(['active', 'completed', 'abandoned']);

export const PENDING_ACTIONS = new Set([
  'idle',
  'awaiting-user-approval',
  'awaiting-execution',
  'awaiting-review',
  'awaiting-rework',
]);

export const CONTEXT_TIERS = [
  { key: 'canonical', kind: 'canonical' },
  { key: 'decisions', kind: 'decision' },
  { key: 'provisional', kind: 'provisional' },
];

export const ARTIFACT_SCHEMAS = [
  {
    directory: 'requirements',
    artifact: 'requirements',
    required: [
      'task_id',
      'artifact',
      'revision',
      'status',
      'based_on',
      'approved_at',
      'approved_by',
      'origin_branch',
      'created_at',
    ],
    statuses: new Set(['draft', 'approved', 'rejected', 'superseded']),
  },
  {
    directory: 'plans',
    artifact: 'plan',
    required: [
      'task_id',
      'artifact',
      'revision',
      'status',
      'requirements_revision',
      'approved_at',
      'approved_by',
      'task_branch',
    ],
    statuses: new Set(['draft', 'approved', 'rejected', 'superseded']),
  },
  {
    directory: 'reviews',
    artifact: 'review',
    required: [
      'task_id',
      'artifact',
      'revision',
      'status',
      'checkpoint_id',
      'plan_revision',
      'requirements_revision',
      'verification_run_ids',
      'waiver_revisions',
      'reviewed_at',
    ],
    statuses: new Set(['draft', 'accepted', 'needs-work']),
  },
  {
    directory: 'summaries',
    artifact: 'summary',
    required: [
      'task_id',
      'artifact',
      'revision',
      'status',
      'disposition',
      'plan_revision',
      'requirements_revision',
      'review_revision',
    ],
    statuses: new Set(['final']),
  },
  {
    directory: 'waivers',
    artifact: 'waiver',
    required: [
      'task_id',
      'artifact',
      'revision',
      'status',
      'scope',
      'checkpoint_id',
      'risk_level',
      'expires_at',
      'approved_at',
      'approved_by',
      'withdrawn_at',
      'withdrawn_by',
      'expired_at',
    ],
    statuses: new Set(['proposed', 'approved', 'expired', 'withdrawn']),
  },
];

export const EXECUTION_NOTE_REQUIRED_KEYS = [
  'task_id',
  'artifact',
  'revision',
  'checkpoint_id',
  'commit',
  'created_at',
  'proposed_memory_updates',
];

export const VERIFICATION_RUN_STATUSES = new Set(['passed', 'failed', 'skipped', 'waived']);

export const WAIVER_RISK_LEVELS = new Set(['low', 'medium', 'high']);

export const EXIT_CODES = {
  success: 0,
  userError: 1,
  stateError: 2,
  gitError: 3,
  validationError: 10,
};

export function isSafeIdentifier(value) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value));
}

export function getArtifactSchema(directory) {
  return ARTIFACT_SCHEMAS.find((schema) => schema.directory === directory) ?? null;
}