export const agentNames = [
  'agent1',
  'agent2',
  'agent3',
  'agent4',
  'agent5',
  'agent6',
  'agent7',
  'agent8',
  'agent9',
] as const;

export type AgentName = (typeof agentNames)[number];

export const stageNames = ['script', 'storyboard', 'video'] as const;
export type StageName = (typeof stageNames)[number];

export const workflowNodes = [
  'agent1_confirmed',
  'agent2',
  'agent2_review',
  'agent3',
  'agent3_review',
  'agent4',
  'agent4_review',
  'script_user_confirm',
  'agent6',
  'agent6_review',
  'agent7',
  'agent7_review',
  'agent8',
  'agent9',
  'video_review',
] as const;

export type WorkflowNode = (typeof workflowNodes)[number];

