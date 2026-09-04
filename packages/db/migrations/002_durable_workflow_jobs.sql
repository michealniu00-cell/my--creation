create table if not exists workflow_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  job_type varchar(30) not null,
  idempotency_key varchar(200) not null,
  payload jsonb not null default '{}'::jsonb,
  status varchar(30) not null default 'queued',
  priority integer not null default 0,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  run_after timestamptz not null default now(),
  timeout_ms integer not null default 900000,
  lease_owner varchar(200),
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  cancel_requested_at timestamptz,
  cancel_reason text,
  checkpoint jsonb not null default '{}'::jsonb,
  checkpoint_version integer not null default 0,
  result jsonb,
  last_error_code varchar(100),
  last_error_message text,
  resume_count integer not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint workflow_jobs_status_check check (
    status in ('queued', 'running', 'retry_scheduled', 'succeeded', 'failed', 'cancelled')
  ),
  constraint workflow_jobs_attempts_check check (
    attempt_count >= 0 and max_attempts > 0 and attempt_count <= max_attempts
  ),
  constraint workflow_jobs_timeout_check check (timeout_ms > 0),
  unique(project_id, job_type, idempotency_key)
);

create table if not exists workflow_job_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references workflow_jobs(id),
  attempt_no integer not null,
  worker_id varchar(200) not null,
  status varchar(30) not null default 'running',
  lease_started_at timestamptz not null,
  lease_expires_at timestamptz not null,
  heartbeat_at timestamptz not null,
  finished_at timestamptz,
  error_code varchar(100),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint workflow_job_attempts_status_check check (
    status in ('running', 'succeeded', 'failed', 'timed_out', 'cancelled', 'lease_expired')
  ),
  unique(job_id, attempt_no)
);

create table if not exists outbox_events (
  id uuid primary key default gen_random_uuid(),
  aggregate_type varchar(50) not null,
  aggregate_id uuid not null,
  event_type varchar(100) not null,
  event_payload jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  publish_attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Keep the direct job lineage queryable without having to inspect JSON payloads.
-- Existing events remain valid because workflow-driven events need not belong to a job.
alter table task_events
  add column if not exists job_id uuid references workflow_jobs(id);

alter table workflow_runs
  add column if not exists origin_job_id uuid references workflow_jobs(id);

create index if not exists idx_workflow_jobs_claim
  on workflow_jobs(status, run_after, priority desc, created_at)
  where deleted_at is null and status in ('queued', 'retry_scheduled');

create index if not exists idx_workflow_jobs_expired_lease
  on workflow_jobs(lease_expires_at)
  where deleted_at is null and status = 'running';

create index if not exists idx_workflow_jobs_project_created
  on workflow_jobs(project_id, created_at desc)
  where deleted_at is null;

create index if not exists idx_workflow_job_attempts_job_attempt
  on workflow_job_attempts(job_id, attempt_no desc)
  where deleted_at is null;

create index if not exists idx_outbox_events_unpublished
  on outbox_events(created_at)
  where deleted_at is null and published_at is null;

create index if not exists idx_task_events_job_created
  on task_events(job_id, created_at desc)
  where deleted_at is null and job_id is not null;

create unique index if not exists uq_workflow_runs_origin_job
  on workflow_runs(origin_job_id)
  where deleted_at is null and origin_job_id is not null;
