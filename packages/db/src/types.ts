import type {
  AgentModelBindingRecord,
  AgentPermissionRecord,
  AgentProfileRecord,
  AgentTaskRecord,
  ArtifactGroupRecord,
  ArtifactVersionRecord,
  FailureSummaryDoc,
  ObjectLockRecord,
  OutboxEventRecord,
  ProjectConfigVersionRecord,
  ProjectRecord,
  ProjectStageSnapshotRecord,
  ProviderCredentialRecord,
  ReviewRecord,
  SceneRecord,
  ShotAssetBindingRecord,
  ShotRecord,
  TaskEventRecord,
  UserAnnotationRecord,
  WorkflowRunRecord,
  WorkflowJobAttemptRecord,
  WorkflowJobRecord,
} from '@video-agent-studio/shared';

export interface DatabaseState {
  projects: ProjectRecord[];
  projectConfigVersions: ProjectConfigVersionRecord[];
  workflowRuns: WorkflowRunRecord[];
  workflowJobs: WorkflowJobRecord[];
  workflowJobAttempts: WorkflowJobAttemptRecord[];
  agentProfiles: AgentProfileRecord[];
  agentModelBindings: AgentModelBindingRecord[];
  providerCredentials: ProviderCredentialRecord[];
  agentPermissions: AgentPermissionRecord[];
  agentTasks: AgentTaskRecord[];
  reviewRecords: ReviewRecord[];
  projectStageSnapshots: ProjectStageSnapshotRecord[];
  failureSummaryDocs: FailureSummaryDoc[];
  scenes: SceneRecord[];
  shots: ShotRecord[];
  artifactGroups: ArtifactGroupRecord[];
  artifactVersions: ArtifactVersionRecord[];
  shotAssetBindings: ShotAssetBindingRecord[];
  objectLocks: ObjectLockRecord[];
  userAnnotations: UserAnnotationRecord[];
  taskEvents: TaskEventRecord[];
  outboxEvents: OutboxEventRecord[];
}
