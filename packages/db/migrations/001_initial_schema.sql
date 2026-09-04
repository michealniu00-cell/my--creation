create extension if not exists pgcrypto;

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  title varchar(200) not null,
  user_id uuid,
  source_idea text not null,
  target_platform varchar(50),
  language varchar(20) not null default 'zh-CN',
  status varchar(30) not null default 'draft',
  current_stage varchar(30) not null default 'script',
  current_config_version_id uuid,
  latest_run_id uuid,
  current_failure_summary_id uuid,
  remark text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists project_config_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  version_no integer not null,
  confirmed_by_user boolean not null default false,
  source_task_id uuid,
  script_type varchar(100),
  style_definition text,
  research_focus text,
  storyline_structure varchar(100),
  script_organization varchar(100),
  global_constraints jsonb not null default '{}'::jsonb,
  config_json jsonb not null default '{}'::jsonb,
  note text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(project_id, version_no)
);

create table if not exists workflow_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  workflow_type varchar(30) not null,
  trigger_mode varchar(30) not null default 'manual',
  start_from_node varchar(50),
  end_at_node varchar(50),
  current_node varchar(50),
  status varchar(30) not null default 'pending',
  run_reason text,
  retry_count integer not null default 0,
  requires_manual_review boolean not null default false,
  error_type varchar(30),
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists agent_profiles (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  agent_name varchar(50) not null,
  version_no integer not null,
  role_definition text not null,
  system_prompt text,
  developer_prompt text,
  input_schema jsonb not null default '{}'::jsonb,
  output_schema jsonb not null default '{}'::jsonb,
  allowed_tools jsonb not null default '[]'::jsonb,
  context_scope jsonb not null default '{}'::jsonb,
  write_scope jsonb not null default '{}'::jsonb,
  delete_scope jsonb not null default '{}'::jsonb,
  review_rules jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(project_id, agent_name, version_no)
);

create table if not exists agent_model_bindings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  agent_name varchar(50) not null,
  provider varchar(50) not null,
  model_name varchar(100) not null,
  temperature numeric(3, 2) default 0.7,
  max_tokens integer,
  timeout_sec integer default 120,
  retry_limit integer default 3,
  extra_config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(project_id, agent_name)
);

create table if not exists agent_permissions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  agent_name varchar(50) not null,
  resource_type varchar(50) not null,
  resource_scope varchar(50) not null,
  can_read boolean not null default false,
  can_create boolean not null default false,
  can_update boolean not null default false,
  can_delete boolean not null default false,
  field_level_rules jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists agent_tasks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references workflow_runs(id),
  project_id uuid not null references projects(id),
  agent_name varchar(50) not null,
  stage_name varchar(30) not null,
  round_no integer not null default 1,
  parent_task_id uuid references agent_tasks(id),
  input_payload jsonb not null default '{}'::jsonb,
  output_json jsonb not null default '{}'::jsonb,
  output_markdown text,
  output_summary text,
  profile_version_id uuid,
  model_binding_id uuid,
  prompt_version varchar(30),
  status varchar(30) not null default 'pending',
  error_type varchar(30),
  error_message text,
  latency_ms integer,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists review_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  run_id uuid not null references workflow_runs(id),
  source_task_id uuid not null references agent_tasks(id),
  reviewer_type varchar(20) not null,
  reviewer_name varchar(50) not null,
  decision varchar(20) not null,
  review_style varchar(20),
  score integer,
  failed_rules jsonb not null default '[]'::jsonb,
  feedback_markdown text,
  revision_brief text,
  review_round integer not null default 1,
  is_final boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists project_stage_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  stage_name varchar(50) not null,
  source_task_id uuid references agent_tasks(id),
  source_artifact_version_id uuid,
  snapshot_json jsonb not null default '{}'::jsonb,
  snapshot_markdown text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists failure_summary_docs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  run_id uuid references workflow_runs(id),
  source_task_id uuid references agent_tasks(id),
  version_no integer not null,
  summary_markdown text not null,
  summary_json jsonb not null default '{}'::jsonb,
  based_on_task_ids jsonb not null default '[]'::jsonb,
  based_on_review_ids jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists scenes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  source_task_id uuid references agent_tasks(id),
  scene_index integer not null,
  title varchar(200),
  script_segment text,
  scene_desc text,
  status varchar(30) not null default 'active',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(project_id, scene_index)
);

create table if not exists shots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  scene_id uuid references scenes(id),
  source_task_id uuid references agent_tasks(id),
  shot_index_global integer not null,
  shot_index_in_scene integer,
  title varchar(200),
  script_segment text,
  scene_desc text,
  subject_desc text,
  action_desc text,
  mood_desc text,
  continuity_notes text,
  status varchar(30) not null default 'active',
  is_user_added boolean not null default false,
  sort_version integer not null default 1,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(project_id, shot_index_global, sort_version)
);

create table if not exists artifact_groups (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  scope_type varchar(30) not null,
  scope_id uuid not null,
  artifact_type varchar(30) not null,
  role varchar(50) not null,
  name varchar(200),
  active_version_id uuid,
  status varchar(30) not null default 'active',
  is_user_managed boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists artifact_versions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references artifact_groups(id),
  version_no integer not null,
  generated_by_agent varchar(50),
  source_task_id uuid references agent_tasks(id),
  mime_type varchar(100),
  storage_bucket varchar(100),
  storage_path text,
  public_url text,
  file_size_bytes bigint,
  width integer,
  height integer,
  duration_ms integer,
  generation_input jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  status varchar(30) not null default 'generated',
  version_note text,
  is_placeholder boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(group_id, version_no)
);

create table if not exists shot_asset_bindings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  shot_id uuid not null references shots(id),
  artifact_group_id uuid not null references artifact_groups(id),
  binding_role varchar(50) not null,
  is_primary boolean not null default false,
  influence_scope varchar(30),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists object_locks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  object_type varchar(30) not null,
  object_id uuid not null,
  lock_scope varchar(30) not null default 'self',
  cascade_children jsonb not null default '[]'::jsonb,
  locked_by_user_id uuid,
  lock_reason text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists user_annotations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  object_type varchar(30) not null,
  object_id uuid not null,
  note_type varchar(30) not null,
  content text not null,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists task_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  run_id uuid references workflow_runs(id),
  task_id uuid references agent_tasks(id),
  event_type varchar(50) not null,
  event_level varchar(20) not null default 'info',
  user_visible boolean not null default false,
  summary text,
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_projects_status_updated on projects(status, updated_at desc);
create index if not exists idx_workflow_runs_project_created on workflow_runs(project_id, created_at desc);
create index if not exists idx_agent_tasks_project_agent_created on agent_tasks(project_id, agent_name, created_at desc);
create index if not exists idx_review_records_source_task_created on review_records(source_task_id, created_at desc);
create index if not exists idx_shots_project_order on shots(project_id, shot_index_global asc);
create index if not exists idx_shot_asset_bindings_role on shot_asset_bindings(shot_id, binding_role);
create index if not exists idx_artifact_versions_group_version on artifact_versions(group_id, version_no desc);
create index if not exists idx_object_locks_project_object on object_locks(project_id, object_type, object_id, is_active);
create index if not exists idx_task_events_project_created on task_events(project_id, created_at desc);

