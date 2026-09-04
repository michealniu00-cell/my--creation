import { createLlmProvider } from '@video-agent-studio/providers';
import type { JsonSchemaFormat } from '@video-agent-studio/providers';
import type { AgentName } from '@video-agent-studio/shared';
import { executeAgentStub } from '../stubs/agent-stubs';
import type { AgentExecutionInput, AgentExecutionOutput } from '../types';

const agentObjectiveMap: Record<AgentName, string> = {
  agent1: '理解用户目标并给出配置建议，帮助项目进入稳定工作流。',
  agent2: '完成项目调研，输出事实依据、洞察和执行建议。',
  agent3: '把调研与创意整理成清晰的故事线与结构卡片。',
  agent4: '输出可进入下游视觉流程的最终脚本。',
  agent5: '执行审核与质量门控。',
  agent6: '把脚本拆成 scene 和 shot 的结构化视觉单元。',
  agent7: '把 shot 扩写成适合生成视觉内容的描述。',
  agent8: '围绕关键分镜和关键要素生成图像侧内容说明。',
  agent9: '围绕分镜和镜头连贯性生成视频侧内容说明。',
};

const executionSchema: JsonSchemaFormat = {
  name: 'agent_execution_result',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      outputSummary: {
        type: 'string',
        description: 'One concise sentence describing the result of this agent execution.',
      },
      outputMarkdown: {
        type: 'string',
        description: 'Readable markdown output for the operator UI.',
      },
      outputJson: {
        type: 'object',
        description: 'Structured result object for downstream workflow usage.',
        additionalProperties: true,
      },
    },
    required: ['outputSummary', 'outputMarkdown', 'outputJson'],
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tryParseJsonObject(text: string) {
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractBalancedJsonObjects(text: string) {
  let depth = 0;
  let start = -1;
  let inString = false;
  let isEscaped = false;
  const objects: string[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }
      if (char === '\\') {
        isEscaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char !== '}' || depth === 0) {
      continue;
    }

    depth -= 1;
    if (depth !== 0 || start < 0) {
      continue;
    }

    objects.push(text.slice(start, index + 1));
    start = -1;
  }

  return objects;
}

function stripThinkTags(text: string) {
  return text.replace(/<\/?think>/gi, ' ').replace(/<think\b[^>]*>/gi, ' ');
}

function scoreStructuredCandidate(value: Record<string, unknown>) {
  let score = 0;
  if (typeof value.outputSummary === 'string') {
    score += 2;
  }
  if (typeof value.outputMarkdown === 'string') {
    score += 3;
  }
  if (isRecord(value.outputJson)) {
    score += 5;
  }
  return score;
}

function rankStructuredCandidates(candidates: Array<Record<string, unknown>>) {
  return candidates
    .map((value, index) => ({
      value,
      index,
      score: scoreStructuredCandidate(value),
    }))
    .sort((left, right) => right.score - left.score || right.index - left.index);
}

function extractStructuredJson(text: string) {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, ' ').trim();
  const trimmed = cleaned || text.trim();
  if (!trimmed) {
    return null;
  }

  const candidates: Array<Record<string, unknown>> = [];
  const stripped = stripThinkTags(trimmed).trim();
  const direct = tryParseJsonObject(stripped);
  if (direct) {
    candidates.push(direct);
  }

  const fenced = stripped.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim();
  if (fenced) {
    const parsedFence = tryParseJsonObject(fenced);
    if (parsedFence) {
      candidates.push(parsedFence);
    }
  }

  for (const candidate of extractBalancedJsonObjects(stripped)) {
    const parsed = tryParseJsonObject(candidate);
    if (parsed) {
      candidates.push(parsed);
    }
  }

  const ranked = rankStructuredCandidates(candidates);
  return ranked[0]?.value ?? null;
}

function extractNestedString(
  value: Record<string, unknown> | undefined,
  path: string[],
): string | null {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current) || !(key in current)) {
      return null;
    }
    current = current[key];
  }

  return typeof current === 'string' && current.trim().length > 0 ? current.trim() : null;
}

function stringifyIfPresent(label: string, value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0 ? `${label}: ${value}` : null;
  }
  if (Array.isArray(value) || isRecord(value)) {
    return `${label}:\n${JSON.stringify(value, null, 2)}`;
  }
  return `${label}: ${String(value)}`;
}

function compactJsonValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 600 ? `${trimmed.slice(0, 600)}…` : trimmed;
  }

  if (Array.isArray(value)) {
    const maxItems = depth === 0 ? 10 : 6;
    return value.slice(0, maxItems).map((item) => compactJsonValue(item, depth + 1));
  }

  if (!isRecord(value)) {
    return value;
  }

  const entries = Object.entries(value);
  const limitedEntries = depth === 0 ? entries.slice(0, 20) : entries.slice(0, 12);
  return Object.fromEntries(
    limitedEntries.map(([key, entryValue]) => [key, compactJsonValue(entryValue, depth + 1)]),
  );
}

function compactSnapshotForPrompt(snapshot: Record<string, unknown>) {
  const compact: Record<string, unknown> = {};

  if (typeof snapshot.stageName === 'string') {
    compact.stageName = snapshot.stageName;
  }
  if (typeof snapshot.sourceTaskId === 'string') {
    compact.sourceTaskId = snapshot.sourceTaskId;
  }
  if (isRecord(snapshot.snapshotJson)) {
    compact.snapshotJson = compactJsonValue(snapshot.snapshotJson);
  }
  if (typeof snapshot.snapshotMarkdown === 'string' && snapshot.snapshotMarkdown.trim().length > 0) {
    compact.snapshotMarkdownExcerpt = snapshot.snapshotMarkdown.trim().slice(0, 1400);
  }

  return compact;
}

function compactContextForPrompt(context: Record<string, unknown> | undefined) {
  if (!isRecord(context)) {
    return {};
  }

  const compact: Record<string, unknown> = { ...context };
  const activeSnapshots = isRecord(context.activeSnapshots) ? context.activeSnapshots : null;
  if (activeSnapshots) {
    compact.activeSnapshots = Object.fromEntries(
      Object.entries(activeSnapshots).map(([key, snapshot]) => [
        key,
        isRecord(snapshot) ? compactSnapshotForPrompt(snapshot) : snapshot,
      ]),
    );
  }

  return compact;
}

function buildAgentSpecificRequirements(agentName: AgentName) {
  switch (agentName) {
    case 'agent2':
      return [
        'Agent-specific requirements:',
        '- outputMarkdown must include the sections "## 调研目标", "## 事实依据", "## 洞察与风险", and "## 创作建议".',
        '- outputJson should include facts, insights, recommendations, and openQuestions arrays.',
        '- facts should contain at least 4 concrete fact items, each with a topic/detail/whyItMatters style of detail when possible.',
        '- insights should explain audience preference, content risk, or narrative opportunity, not generic slogans.',
        '- recommendations should translate research into executable downstream guidance for storyline and script writing.',
      ].join('\n');
    case 'agent3':
      return [
        'Agent-specific requirements:',
        '- outputMarkdown must include the sections "## 故事总纲", "## 结构卡片", and "## 节奏与情绪设计".',
        '- outputJson should include storylineCards as an array with at least 4 cards.',
        '- each storyline card should include title, purpose, conflictOrTurn, visualAnchor, and emotionalBeat.',
        '- the storyline must clearly show beginning, escalation, turn, payoff, and ending impression.',
      ].join('\n');
    case 'agent4':
      return [
        'Agent-specific requirements:',
        '- outputMarkdown must include the sections "## 片子定位", "## 成片目标", and "## 分段脚本".',
        '- outputJson should include scriptSections with at least 3 sections.',
        '- each script section should contain sectionTitle, visuals, narration, keyBeat, and transitionToNext.',
        '- the script must be detailed enough for downstream shot decomposition and should not collapse into one paragraph.',
      ].join('\n');
    case 'agent6':
      return [
        'Agent-specific requirements:',
        '- outputMarkdown must include the sections "## 场景拆解", "## Shot 列表", and "## 连贯性说明".',
        '- outputJson should include a scenes array whose length is decided by the script itself, not by an arbitrary fixed number.',
        '- determine the number of scenes and shots according to Agent4 final script structure, narrative rhythm, transition needs, and visual execution feasibility.',
        '- preserve the information density of Agent4 final script: every key claim, data point, turn, and actionable conclusion should still appear in sceneDesc, scriptSegment, subjectDesc, or actionDesc instead of being collapsed into generic labels.',
        '- if Agent4 contains percentages, company names, time references, evidence hooks, or explicit narrative beats, keep them in the scene/shot breakdown where they belong.',
        '- each scene should include title, sceneDesc, and shots.',
        '- each shot should include title, scriptSegment, subjectDesc, actionDesc, moodDesc, and continuityNotes.',
        '- if one story beat needs multiple shots, split it into multiple shots; if a scene is complex enough to require more than one scene card, separate it accordingly.',
        '- do not collapse everything into 2 scenes or 3 shots by default. Make an explicit judgement and reflect it in the output structure.',
        '- if Agent4 script implies on-screen text, title cards, logos, charts, UI blocks, or explicit layout/order requirements, preserve those requirements inside the relevant shot descriptions instead of abstracting them away.',
        '- the result must be concrete enough for downstream storyboard generation and shot ordering.',
      ].join('\n');
    case 'agent7':
      return [
        'Agent-specific requirements:',
        '- outputMarkdown must include the sections "## 扩写原则" and "## Shot 扩写结果".',
        '- outputMarkdown should stay concise for operator review: do not rewrite the entire project rationale or repeat every field in prose.',
        '- outputJson should include shotExpansions as an array whose length exactly matches the shotCount provided in the input payload, preserving source order.',
        '- each item should include shotIndexGlobal, shotTitle, scriptSegment, subjectDesc, actionDesc, mood, continuityNotes, visualPrompt, lighting, cameraMotion, compositionNotes, and styleNotes.',
        '- first priority is shot fidelity, not cross-shot consistency. Expand every shot so Agent8 can accurately render the specific shot description before considering continuity.',
        '- visualPrompt must be directly usable as a storyboard/image generation prompt for Agent8, with the shot-specific subject, information content, on-screen text, layout hierarchy, element positions, and reading order clearly described.',
        '- compositionNotes must explicitly cover layout, text arrangement, visual hierarchy, element placement, and order of appearance whenever the shot contains titles, subtitles, logos, charts, figures, UI, or data callouts.',
        '- styleNotes should be treated as secondary constraints. Keep them subordinate to the current shot description.',
        '- keep each shot expansion compact but complete; put detailed per-shot data in outputJson instead of long markdown exposition.',
        '- preserve Agent6 and Agent4 meaning: do not drop key claims, data hooks, or narrative turns when expanding shots.',
      ].join('\n');
    default:
      return null;
  }
}

function buildInstructions(input: AgentExecutionInput) {
  const instructions = [
    `You are ${input.agentName} working inside a multi-agent video production workflow.`,
    `Stage: ${input.stageName}.`,
    `Primary objective: ${agentObjectiveMap[input.agentName]}`,
    'Return content that is actionable, internally consistent, and suitable for downstream review.',
    'Always fill outputSummary, outputMarkdown, and outputJson.',
    'Keep outputMarkdown dense, specific, and suitable for operator review.',
    'Write outputJson using clear keys and stable nested objects or arrays.',
    'When structured output is requested, return raw JSON only. Do not wrap it in Markdown code fences or add commentary before or after it.',
  ];

  const agentRequirements = buildAgentSpecificRequirements(input.agentName);
  if (agentRequirements) {
    instructions.push(agentRequirements);
  }

  if (input.profile?.roleDefinition) {
    instructions.push(`Role definition: ${input.profile.roleDefinition}`);
  }
  if (input.profile?.systemPrompt) {
    instructions.push(`System prompt: ${input.profile.systemPrompt}`);
  }
  if (input.profile?.developerPrompt) {
    instructions.push(`Developer prompt: ${input.profile.developerPrompt}`);
  }
  if (input.profile?.reviewRules?.length) {
    instructions.push(`Review rules: ${input.profile.reviewRules.join('; ')}`);
  }

  return instructions.join('\n');
}

function buildPrompt(input: AgentExecutionInput) {
  const compactContext = compactContextForPrompt(input.context);
  const activeConfig = isRecord(compactContext.activeConfig) ? compactContext.activeConfig : undefined;
  const inputPayload = isRecord(compactContext.inputPayload) ? compactContext.inputPayload : undefined;
  const contextWithoutInputPayload = { ...compactContext };
  delete contextWithoutInputPayload.inputPayload;
  const revisionBrief =
    extractNestedString(compactContext, ['revisionBrief']) ??
    extractNestedString(inputPayload, ['revisionBrief']) ??
    extractNestedString(compactContext, ['failureSummaryMarkdown']);

  return [
    `Project title: ${input.projectTitle}`,
    `Source idea: ${input.sourceIdea ?? 'N/A'}`,
    stringifyIfPresent('Current active config', activeConfig),
    stringifyIfPresent('Current task payload', inputPayload),
    revisionBrief ? `Revision brief: ${revisionBrief}` : null,
    '',
    'Workflow context JSON:',
    JSON.stringify(contextWithoutInputPayload, null, 2),
  ]
    .filter((item): item is string => Boolean(item))
    .join('\n');
}

function buildRetryPrompt(input: AgentExecutionInput) {
  const compactContext = compactContextForPrompt(input.context);
  const activeConfig = isRecord(compactContext.activeConfig) ? compactContext.activeConfig : undefined;
  const inputPayload = isRecord(compactContext.inputPayload) ? compactContext.inputPayload : undefined;
  const revisionBrief =
    extractNestedString(compactContext, ['revisionBrief']) ??
    extractNestedString(inputPayload, ['revisionBrief']) ??
    extractNestedString(compactContext, ['failureSummaryMarkdown']);

  return [
    `Project title: ${input.projectTitle}`,
    `Source idea: ${input.sourceIdea ?? 'N/A'}`,
    stringifyIfPresent('Current active config', compactJsonValue(activeConfig)),
    stringifyIfPresent('Current task payload', compactJsonValue(inputPayload)),
    revisionBrief ? `Revision brief: ${revisionBrief}` : null,
    '',
    'Return only one valid JSON object that matches the required schema exactly.',
  ]
    .filter((item): item is string => Boolean(item))
    .join('\n');
}

function buildRetryInstructions(input: AgentExecutionInput) {
  return [
    buildInstructions(input),
    'Retry mode:',
    '- Your previous response was not a valid structured JSON object.',
    '- Do not output <think> tags, reasoning traces, markdown fences, or any commentary.',
    '- Return exactly one JSON object matching the schema.',
    '- Keep outputMarkdown concise and put detailed structured content in outputJson.',
  ].join('\n');
}

function buildFormattingRecoveryPrompt(input: AgentExecutionInput, draftText: string) {
  const compactContext = compactContextForPrompt(input.context);
  const activeConfig = isRecord(compactContext.activeConfig) ? compactContext.activeConfig : undefined;
  const inputPayload = isRecord(compactContext.inputPayload) ? compactContext.inputPayload : undefined;
  const cleanedDraft = stripThinkTags(draftText).replace(/\s+/g, ' ').trim().slice(0, 3_500);

  return [
    `Project title: ${input.projectTitle}`,
    `Source idea: ${input.sourceIdea ?? 'N/A'}`,
    stringifyIfPresent('Current active config', compactJsonValue(activeConfig)),
    stringifyIfPresent('Current task payload', compactJsonValue(inputPayload)),
    '',
    'Draft content to normalize into the required JSON schema:',
    cleanedDraft,
  ]
    .filter((item): item is string => Boolean(item))
    .join('\n');
}

function buildFormattingRecoveryInstructions(input: AgentExecutionInput) {
  return [
    buildInstructions(input),
    'Formatting recovery mode:',
    '- Ignore any chain-of-thought, preamble, or prose that is not part of the final answer.',
    '- Rebuild the final result as exactly one JSON object matching the schema.',
    '- Use the provided draft as the primary source of truth.',
    '- If the draft is incomplete, infer the minimum needed structure from the task payload without adding unrelated content.',
    '- Do not output markdown fences, commentary, or <think> tags.',
  ].join('\n');
}

function normalizeExecutionOutput(
  value: Record<string, unknown>,
  fallbackPromptVersion: string,
  metadata: Record<string, unknown>,
): AgentExecutionOutput {
  const outputJson = isRecord(value.outputJson) ? value.outputJson : {};
  const outputMarkdown =
    typeof value.outputMarkdown === 'string' ? value.outputMarkdown : '## Agent Output\nNo markdown output.';
  const outputSummary =
    typeof value.outputSummary === 'string' ? value.outputSummary : 'Agent execution completed.';

  return {
    outputJson,
    outputMarkdown,
    outputSummary,
    promptVersion: fallbackPromptVersion,
    metadata,
  };
}

export async function executeAgent(input: AgentExecutionInput): Promise<AgentExecutionOutput> {
  input.signal?.throwIfAborted();
  if (!input.modelBinding || input.modelBinding.provider === 'mock') {
    return executeAgentStub(input);
  }

  const modelBinding = input.modelBinding;
  const provider = createLlmProvider(modelBinding);
  async function attempt(
    prompt: string,
    instructions: string,
    attemptName: 'primary' | 'structured-retry' | 'format-recovery',
  ) {
    const result = await provider.generate({
      prompt,
      instructions,
      temperature: modelBinding.temperature ?? undefined,
      maxOutputTokens: modelBinding.maxTokens ?? undefined,
      jsonSchema: executionSchema,
      signal: input.signal,
      idempotencyKey: input.idempotencyKey
        ? `${input.idempotencyKey}:${attemptName}`
        : undefined,
    });

    const generated = result.json ?? extractStructuredJson(result.text);
    return { result, generated };
  }

  const primaryAttempt = await attempt(
    buildPrompt(input),
    buildInstructions(input),
    'primary',
  );
  if (primaryAttempt.generated) {
    return {
      ...normalizeExecutionOutput(primaryAttempt.generated, `runtime:${primaryAttempt.result.model}`, {
        provider: primaryAttempt.result.provider,
        model: primaryAttempt.result.model,
        responseId: primaryAttempt.result.responseId ?? null,
        ...(primaryAttempt.result.metadata ?? {}),
      }),
      usage: primaryAttempt.result.usage,
      providerName: primaryAttempt.result.provider,
      modelName: primaryAttempt.result.model,
    };
  }

  const retryAttempt = await attempt(
    buildRetryPrompt(input),
    buildRetryInstructions(input),
    'structured-retry',
  );
  if (retryAttempt.generated) {
    return {
      ...normalizeExecutionOutput(retryAttempt.generated, `runtime:${retryAttempt.result.model}`, {
        provider: retryAttempt.result.provider,
        model: retryAttempt.result.model,
        responseId: retryAttempt.result.responseId ?? null,
        retriedForStructuredOutput: true,
        ...(retryAttempt.result.metadata ?? {}),
      }),
      usage: retryAttempt.result.usage,
      providerName: retryAttempt.result.provider,
      modelName: retryAttempt.result.model,
    };
  }

  const recoveryDraft =
    [primaryAttempt.result.text, retryAttempt.result.text]
      .map((value) => stripThinkTags(value).trim())
      .sort((left, right) => right.length - left.length)[0] ?? '';

  if (recoveryDraft) {
    const recoveryAttempt = await attempt(
      buildFormattingRecoveryPrompt(input, recoveryDraft),
      buildFormattingRecoveryInstructions(input),
      'format-recovery',
    );

    if (recoveryAttempt.generated) {
      return {
        ...normalizeExecutionOutput(recoveryAttempt.generated, `runtime:${recoveryAttempt.result.model}`, {
          provider: recoveryAttempt.result.provider,
          model: recoveryAttempt.result.model,
          responseId: recoveryAttempt.result.responseId ?? null,
          recoveredFromDraft: true,
          ...(recoveryAttempt.result.metadata ?? {}),
        }),
        usage: recoveryAttempt.result.usage,
        providerName: recoveryAttempt.result.provider,
        modelName: recoveryAttempt.result.model,
      };
    }
  }

  const preview = retryAttempt.result.text.trim().replace(/\s+/g, ' ').slice(0, 220);
  throw new Error(
    `Provider ${retryAttempt.result.provider} did not return a valid structured agent payload${
      preview ? `; preview: ${preview}` : ''
    }`,
  );
}
