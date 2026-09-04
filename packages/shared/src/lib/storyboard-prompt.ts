type StoryboardPromptShot = {
  title?: string | null;
  scriptSegment?: string | null;
  sceneDesc?: string | null;
  subjectDesc?: string | null;
  actionDesc?: string | null;
  moodDesc?: string | null;
  continuityNotes?: string | null;
  visualPrompt?: string | null;
  lighting?: string | null;
  cameraMotion?: string | null;
  compositionNotes?: string | null;
  styleNotes?: string | null;
};

type StoryboardPromptOptions = {
  promptHint?: string | null;
  hasReferenceImage?: boolean;
};

const MINIMAX_STORYBOARD_PROMPT_LIMIT = 1450;

type PromptSegment = {
  label: string;
  value: string | null;
  maxLength: number;
  optional?: boolean;
};

function compactPromptText(value: string | null | undefined, maxLength: number) {
  if (typeof value !== 'string') {
    return null;
  }

  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return null;
  }

  return compact.length > maxLength ? `${compact.slice(0, Math.max(0, maxLength - 1)).trim()}…` : compact;
}

function stringifySegment(segment: PromptSegment) {
  const compact = compactPromptText(segment.value, segment.maxLength);
  return compact ? `${segment.label}: ${compact}` : null;
}

export function buildStoryboardImagePrompt(
  projectTitle: string,
  shot: StoryboardPromptShot,
  options: StoryboardPromptOptions = {},
) {
  const segments: PromptSegment[] = [
    { label: '项目', value: projectTitle, maxLength: 60, optional: true },
    { label: 'Shot', value: shot.title ?? null, maxLength: 60 },
    {
      label: '目标',
      value: '优先完整还原当前shot的文字、内容、排版、位置与顺序；画面一致性仅为次级约束。',
      maxLength: 80,
    },
    {
      label: '脚本',
      value: shot.scriptSegment ?? null,
      maxLength: 170,
    },
    {
      label: '场景',
      value: shot.sceneDesc ?? null,
      maxLength: 110,
      optional: true,
    },
    {
      label: '主体',
      value: shot.subjectDesc ?? null,
      maxLength: 100,
      optional: true,
    },
    {
      label: '动作',
      value: shot.actionDesc ?? null,
      maxLength: 120,
      optional: true,
    },
    {
      label: '氛围',
      value: shot.moodDesc ?? null,
      maxLength: 50,
      optional: true,
    },
    {
      label: '核心画面',
      value: shot.visualPrompt ?? null,
      maxLength: 280,
    },
    {
      label: '构图排版',
      value:
        shot.compositionNotes ??
        '明确主次层级、文字排版、元素位置、信息顺序和画面留白；如含标题、字幕、LOGO、图表、数字、UI，请优先保留原文、层级、位置与阅读顺序。',
      maxLength: 220,
    },
    {
      label: '光线',
      value: shot.lighting ?? null,
      maxLength: 50,
      optional: true,
    },
    {
      label: '镜头',
      value: shot.cameraMotion ?? null,
      maxLength: 50,
      optional: true,
    },
    {
      label: '风格',
      value: shot.styleNotes ?? null,
      maxLength: 60,
      optional: true,
    },
    {
      label: '连续性',
      value:
        shot.continuityNotes ??
        '仅在不损伤当前shot描述准确性的前提下，再考虑前后镜头连续性。',
      maxLength: 70,
      optional: true,
    },
    {
      label: '参考图',
      value: options.hasReferenceImage
        ? '参考图仅作辅助；若与当前shot描述冲突，以当前shot描述为准。'
        : null,
      maxLength: 45,
      optional: true,
    },
    {
      label: '附加指令',
      value: options.promptHint ?? null,
      maxLength: 80,
      optional: true,
    },
    {
      label: '输出',
      value: '16:9 单张关键分镜图。',
      maxLength: 20,
    },
  ];

  const requiredLines = segments
    .filter((segment) => !segment.optional)
    .map(stringifySegment)
    .filter((line): line is string => Boolean(line));

  const optionalLines = segments
    .filter((segment) => segment.optional)
    .map(stringifySegment)
    .filter((line): line is string => Boolean(line));

  const lines = [...requiredLines];
  let prompt = lines.join('\n');

  for (const line of optionalLines) {
    const candidate = prompt ? `${prompt}\n${line}` : line;
    if (candidate.length > MINIMAX_STORYBOARD_PROMPT_LIMIT) {
      continue;
    }
    prompt = candidate;
  }

  if (prompt.length <= MINIMAX_STORYBOARD_PROMPT_LIMIT) {
    return prompt;
  }

  return `${prompt.slice(0, MINIMAX_STORYBOARD_PROMPT_LIMIT - 1).trim()}…`;
}
