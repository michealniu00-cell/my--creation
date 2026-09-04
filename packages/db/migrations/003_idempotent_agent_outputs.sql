alter table agent_tasks
  add column if not exists execution_key text;

create unique index if not exists uq_agent_tasks_run_execution_key
  on agent_tasks(run_id, execution_key)
  where deleted_at is null and execution_key is not null;

create unique index if not exists uq_agent_reviews_source_round_reviewer
  on review_records(source_task_id, review_round, reviewer_type, reviewer_name)
  where deleted_at is null and reviewer_type = 'agent';

create unique index if not exists uq_stage_snapshots_source_task
  on project_stage_snapshots(source_task_id, stage_name)
  where deleted_at is null and source_task_id is not null;

create unique index if not exists uq_artifact_versions_execution_key
  on artifact_versions(group_id, (generation_input->>'executionKey'))
  where deleted_at is null and generation_input ? 'executionKey';
