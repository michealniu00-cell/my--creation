import type { AgentName, AgentTaskRecord, ReviewRecord } from '@video-agent-studio/shared';

const reviewThresholds: Partial<Record<AgentName, number>> = {
  agent2: 320,
  agent3: 260,
  agent4: 420,
  agent6: 60,
  agent7: 80,
  agent9: 20,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
  return asArray(value).filter((item): item is Record<string, unknown> => isRecord(item));
}

function countHeadings(markdown: string, marker = '### ') {
  return markdown
    .split('\n')
    .filter((line) => line.trim().startsWith(marker))
    .length;
}

function hasTextField(item: Record<string, unknown>, key: string) {
  const value = item[key];
  return typeof value === 'string' && value.trim().length > 0;
}

function applyAgentSpecificRules(task: AgentTaskRecord, failedRules: string[]) {
  const markdown = task.outputMarkdown ?? '';
  const outputJson = task.outputJson ?? {};

  if (task.agentName === 'agent2') {
    const facts = asArray(outputJson.facts);
    const insights = asArray(outputJson.insights);
    const recommendations = asArray(outputJson.recommendations);

    if (facts.length < 4) {
      failedRules.push('research_facts_insufficient');
    }
    if (insights.length < 2) {
      failedRules.push('research_insights_insufficient');
    }
    if (recommendations.length < 2) {
      failedRules.push('research_recommendations_insufficient');
    }
    if (!markdown.includes('## 调研目标') || !markdown.includes('## 创作建议')) {
      failedRules.push('research_structure_missing');
    }
  }

  if (task.agentName === 'agent3') {
    const storylineCards = asObjectArray(outputJson.storylineCards);
    const completeCardCount = storylineCards.filter(
      (card) =>
        hasTextField(card, 'title') &&
        hasTextField(card, 'purpose') &&
        (hasTextField(card, 'conflictOrTurn') || hasTextField(card, 'visualAnchor')),
    ).length;

    if (storylineCards.length < 4) {
      failedRules.push('storyline_cards_insufficient');
    }
    if (completeCardCount < 4) {
      failedRules.push('storyline_cards_missing_fields');
    }
    if (!markdown.includes('## 结构卡片')) {
      failedRules.push('storyline_structure_missing');
    }
  }

  if (task.agentName === 'agent4') {
    const scriptSections = asObjectArray(outputJson.scriptSections);
    const detailedSections = scriptSections.filter(
      (section) =>
        (hasTextField(section, 'sectionTitle') || hasTextField(section, 'title')) &&
        (hasTextField(section, 'narration') || hasTextField(section, 'voiceover')) &&
        (hasTextField(section, 'keyBeat') || hasTextField(section, 'purpose')) &&
        (Array.isArray(section.visuals) || hasTextField(section, 'visuals')),
    ).length;

    if (scriptSections.length < 3 && countHeadings(markdown) < 3) {
      failedRules.push('script_sections_insufficient');
    }
    if (detailedSections < 3 && !(/旁白|解说|台词/.test(markdown) && /画面|镜头/.test(markdown))) {
      failedRules.push('script_missing_visual_narration_pairs');
    }
    if (!markdown.includes('## 分段脚本')) {
      failedRules.push('script_structure_missing');
    }
  }

  if (task.agentName === 'agent6') {
    const scenes = asObjectArray(outputJson.scenes);
    const sceneCount = scenes.length;
    const totalShots = scenes.reduce((count, scene) => count + asObjectArray(scene.shots).length, 0);
    const validSceneCount = scenes.filter(
      (scene) => hasTextField(scene, 'title') && (hasTextField(scene, 'sceneDesc') || hasTextField(scene, 'scriptSegment')),
    ).length;
    const validShotCount = scenes.reduce((count, scene) => {
      return (
        count +
        asObjectArray(scene.shots).filter(
          (shot) =>
            hasTextField(shot, 'title') &&
            hasTextField(shot, 'scriptSegment') &&
            hasTextField(shot, 'subjectDesc') &&
            hasTextField(shot, 'actionDesc') &&
            hasTextField(shot, 'moodDesc') &&
            hasTextField(shot, 'continuityNotes'),
        ).length
      );
    }, 0);

    if (sceneCount < 1) {
      failedRules.push('scene_breakdown_missing');
    }
    if (validSceneCount < sceneCount) {
      failedRules.push('scene_breakdown_missing_fields');
    }
    if (totalShots < 2) {
      failedRules.push('shot_breakdown_insufficient');
    }
    if (validShotCount < totalShots) {
      failedRules.push('shot_breakdown_missing_fields');
    }
    if (!markdown.includes('## 场景拆解') || !markdown.includes('## Shot 列表')) {
      failedRules.push('shot_breakdown_structure_missing');
    }
  }

  if (task.agentName === 'agent7') {
    const shotExpansions = asObjectArray(
      outputJson.shotExpansions ?? outputJson.expansions ?? outputJson.shots,
    );
    const expectedShotCount =
      typeof task.inputPayload?.shotCount === 'number' ? Number(task.inputPayload.shotCount) : null;
    const minimumExpectedCount = expectedShotCount ? Math.max(1, Math.min(3, expectedShotCount)) : 3;
    const validExpansionCount = shotExpansions.filter(
      (item) =>
        (hasTextField(item, 'shotTitle') || hasTextField(item, 'title')) &&
        hasTextField(item, 'visualPrompt') &&
        (hasTextField(item, 'scriptSegment') || hasTextField(item, 'subjectDesc')) &&
        (hasTextField(item, 'mood') || hasTextField(item, 'moodDesc')) &&
        hasTextField(item, 'continuityNotes') &&
        hasTextField(item, 'lighting') &&
        hasTextField(item, 'cameraMotion') &&
        hasTextField(item, 'compositionNotes') &&
        hasTextField(item, 'styleNotes'),
    ).length;

    if (shotExpansions.length < minimumExpectedCount) {
      failedRules.push('shot_expansion_insufficient');
    }
    if (expectedShotCount && shotExpansions.length !== expectedShotCount) {
      failedRules.push('shot_expansion_count_mismatch');
    }
    if (validExpansionCount < shotExpansions.length) {
      failedRules.push('shot_expansion_missing_fields');
    }
    if (!markdown.includes('## 扩写原则') || !markdown.includes('## Shot 扩写结果')) {
      failedRules.push('shot_expansion_structure_missing');
    }
  }
}

export function reviewTaskOutput(task: AgentTaskRecord): Omit<ReviewRecord, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'> {
  const contentLength = `${task.outputMarkdown ?? ''}${JSON.stringify(task.outputJson ?? {})}`.length;
  const threshold = reviewThresholds[task.agentName] ?? 40;
  const failedRules: string[] = [];

  if (contentLength < threshold) {
    failedRules.push('content_too_short');
  }

  if ((task.outputMarkdown ?? '').includes('TODO')) {
    failedRules.push('contains_placeholder_content');
  }

  applyAgentSpecificRules(task, failedRules);

  return {
    projectId: task.projectId,
    runId: task.runId,
    sourceTaskId: task.id,
    reviewerType: 'agent',
    reviewerName: 'agent5',
    decision: failedRules.length > 0 ? 'revise' : 'pass',
    reviewStyle: 'balanced',
    score: failedRules.length > 0 ? 60 : 88,
    failedRules,
    feedbackMarkdown:
      failedRules.length > 0
        ? '当前输出仍不够稳定，建议按 revision brief 补足细节后重试。'
        : '审核通过，可继续进入下一节点。',
    revisionBrief:
      failedRules.length > 0 ? '补充更完整的结构、细节和可执行信息。' : null,
    reviewRound: task.roundNo,
    isFinal: true,
  };
}

export function buildFailureSummary(taskHistory: AgentTaskRecord[]) {
  const lastTask = taskHistory.at(-1);
  return {
    markdown: `## 三次失败后重规划\n节点：${lastTask?.agentName ?? 'unknown'}\n建议：回到 Agent1 重新梳理任务标准，并补充上轮失败原因。`,
    summaryJson: {
      failedTaskIds: taskHistory.map((task) => task.id),
      summary: '连续失败触发重规划',
    },
  };
}
