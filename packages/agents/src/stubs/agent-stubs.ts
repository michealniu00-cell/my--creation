import type { AgentExecutionInput, AgentExecutionOutput } from '../types';

const line = (text: string) => `- ${text}`;

function getRevisionBrief(input: AgentExecutionInput) {
  const revisionBrief =
    input.context?.revisionBrief ??
    (typeof input.context?.inputPayload === 'object' &&
    input.context?.inputPayload !== null &&
    'revisionBrief' in input.context.inputPayload
      ? input.context.inputPayload.revisionBrief
      : null);

  return typeof revisionBrief === 'string' && revisionBrief.trim().length > 0
    ? revisionBrief.trim()
    : null;
}

export function executeAgentStub(input: AgentExecutionInput): AgentExecutionOutput {
  const revisionBrief = getRevisionBrief(input);

  switch (input.agentName) {
    case 'agent1':
      return {
        outputJson: {
          projectUnderstanding: `围绕《${input.projectTitle}》构建强流程视频创作项目。`,
          recommendedConfig: {
            scriptType: '混合型',
            styleDefinition: '电影感、叙事感',
            researchFocus: '事实依据 + 内容洞察',
            storylineStructure: '场景卡片式',
            scriptOrganization: '按场景',
          },
        },
        outputMarkdown: ['## Agent1 建议', line('确认项目目标与风格'), line('定义调研与脚本标准')].join('\n'),
        outputSummary: '完成需求理解与配置建议',
        promptVersion: 'v1',
        providerName: 'mock',
        modelName: input.modelBinding?.modelName ?? 'mock-llm',
      };
    case 'agent2':
      return {
        outputJson: {
          researchGoal: '为后续故事线和脚本提供可靠的事实抓手、受众洞察与创作边界。',
          facts: [
            {
              topic: '受众关切',
              detail: '讨论 AI 价值时，观众更容易被真实职业与生活场景带入，而不是抽象技术名词。',
              whyItMatters: '能把宏大命题落到具体人物和具体时刻上。',
            },
            {
              topic: '叙事风险',
              detail: '如果只讲“技术革命”，内容容易空泛、像观点拼贴，难以形成记忆点。',
              whyItMatters: '后续脚本必须建立可见冲突和情绪推进。',
            },
            {
              topic: '短视频表达',
              detail: '短视频更偏好结论鲜明、画面锚点明确、段落推进清晰的内容组织方式。',
              whyItMatters: '故事线需要分出钩子、转折、收束，而不是均匀铺陈。',
            },
            {
              topic: '视觉策略',
              detail: '“人机协作”“职业变化”“生产效率跃迁”是天然可视化的表达切口。',
              whyItMatters: '能帮助 shot 阶段快速找到统一的角色、道具与空间锚点。',
            },
            {
              topic: '论证方式',
              detail: '观众更容易接受“AI 改变了哪些具体工作方式”而不是“AI 很强”的空泛判断。',
              whyItMatters: 'Agent4 需要把观点拆成可见行为与前后对比。',
            },
          ],
          insights: [
            '这类主题最有效的进入方式不是先下结论，而是先让观众看到“旧流程”和“新流程”的差异。',
            '内容需要在“效率提升”与“人的判断仍然重要”之间保持平衡，避免单边夸大。',
            '适合把抽象议题包装成一个逐步升级的观察过程，而不是知识科普口播。',
          ],
          recommendations: [
            '故事线先建立一个传统工作场景，再逐步引入 AI 介入后的变化与张力。',
            '最终脚本要为每个关键段落提供视觉锚点、旁白逻辑和情绪目标，不能只写一段总结。',
            '下游 shot 拆解时优先保留“人物动作 + 工具反馈 + 结果变化”这三类信息。',
          ],
          openQuestions: [
            '项目最终是偏纪录观察、评论表达，还是故事化短片？',
            '脚本语气更偏冷静分析，还是偏情绪推进与观点冲击？',
          ],
        },
        outputMarkdown: [
          '## 调研目标',
          '围绕“AI 的作用究竟是什么，是否构成新的工业革命”这个命题，提炼出能支撑故事线和最终脚本的事实依据、受众心理和可视化表达抓手。',
          '',
          '## 事实依据',
          line('观众更容易被真实职业场景与具体任务变化打动，而不是抽象技术口号。'),
          line('一旦只讲概念，视频会迅速失去代入感，后续分镜也很难统一。'),
          line('短视频叙事更适合先抛出现象，再揭示变化逻辑，最后回到观点落点。'),
          line('“旧流程 vs 新流程”的对照天然适合转成镜头设计与节奏推进。'),
          '',
          '## 洞察与风险',
          line('最有传播力的不是“大革命”三个字，而是 AI 如何改写人一天的工作方式。'),
          line('风险在于如果没有具体人物与场景，视频会沦为抽象评论，难以形成记忆点。'),
          line('建议在观点表达时保留复杂性，既呈现效率提升，也保留人类判断与责任。'),
          '',
          '## 创作建议',
          line('故事线采用“建立旧秩序 -> 出现新变量 -> 观察冲突 -> 给出判断”的结构。'),
          line('最终脚本需要为每一段补齐画面锚点、旁白目标和转场逻辑。'),
          line(`当前版本${revisionBrief ? `需特别修复：${revisionBrief}` : '应避免泛泛而谈，直接服务下游创作。'}`),
        ].join('\n'),
        outputSummary: '完成调研',
        promptVersion: 'v1',
        providerName: 'mock',
        modelName: input.modelBinding?.modelName ?? 'mock-llm',
      };
    case 'agent3':
      return {
        outputJson: {
          storylineCards: [
            {
              title: '提出问题',
              purpose: '用一个具体职业切口把观众拉进主题',
              conflictOrTurn: '人已经很熟练，但旧流程依然缓慢且重复',
              visualAnchor: '桌面堆满稿纸、时间被碎片任务切走',
              emotionalBeat: '压抑、疲惫、问题悬而未决',
            },
            {
              title: '引入 AI',
              purpose: '让新变量进入系统，形成观察视角',
              conflictOrTurn: 'AI 提供速度和新方案，但也带来判断边界问题',
              visualAnchor: '人机协作界面、方案快速生成、信息被重新组织',
              emotionalBeat: '惊讶、期待、谨慎',
            },
            {
              title: '放大变化',
              purpose: '展示流程、角色和产出质量的真正变化',
              conflictOrTurn: '效率提升明显，但是否会取代人的价值仍存在争论',
              visualAnchor: '多个岗位协同提速、旧流程与新流程交叉对照',
              emotionalBeat: '张力上升、判断分裂',
            },
            {
              title: '完成转折',
              purpose: '从“工具替代”转向“生产关系变化”的更高层判断',
              conflictOrTurn: '关键不是 AI 会不会做，而是谁来定义目标、审核结果、承担责任',
              visualAnchor: '人重新站回决策位，AI 成为能力放大器',
              emotionalBeat: '思考、沉稳、认知翻转',
            },
            {
              title: '观点收束',
              purpose: '给视频一个兼具力度与余味的结束点',
              conflictOrTurn: '工业革命的意义不在技术本身，而在它如何重塑人和生产方式',
              visualAnchor: '从个体工作台切到更宏观的产业景象',
              emotionalBeat: '开阔、坚定、留白',
            },
          ],
          narrativeHook: '从一个具体工作场景切入，避免抽象讨论直接压在观众头上。',
          endingPayoff: '把 AI 的意义落到生产方式重组，而不是停留在工具炫技。',
        },
        outputMarkdown: [
          '## 故事总纲',
          '用一个普通工作者的日常切入 AI 议题，先建立旧流程的沉重感，再引入 AI 造成的速度、认知与角色变化，最终把问题抬升到“生产方式是否被重组”。',
          '',
          '## 结构卡片',
          line('卡片 1 提出问题：先让观众看到旧流程为何让人疲惫和低效。'),
          line('卡片 2 引入 AI：让观众看到变化开始发生，但保持对边界问题的警惕。'),
          line('卡片 3 放大变化：把流程提速、岗位协作变化、质量控制难题一并抛出。'),
          line('卡片 4 完成转折：把焦点从“替代”转到“重组”，强调人的判断依然关键。'),
          line('卡片 5 观点收束：回到工业革命命题，给出更成熟的最终判断。'),
          '',
          '## 节奏与情绪设计',
          line('前段快速建立现实压力，中段提高信息密度和冲突感，结尾转为更开阔的价值判断。'),
          line(`当前版本${revisionBrief ? `应重点修复：${revisionBrief}` : '应直接服务最终脚本，不要停在口号层。'}`),
        ].join('\n'),
        outputSummary: '完成故事线',
        promptVersion: 'v1',
        providerName: 'mock',
        modelName: input.modelBinding?.modelName ?? 'mock-llm',
      };
    case 'agent4':
      return {
        outputJson: {
          scriptTitle: `${input.projectTitle} 最终脚本`,
          runtimeTargetSec: 85,
          voiceStyle: '理性叙事中带一点情绪推进，避免空喊口号。',
          scriptSections: [
            {
              sectionTitle: '段落一：旧流程的重量',
              keyBeat: '先让观众看到问题，而不是先听观点。',
              visuals: [
                '清晨的工位，屏幕、纸稿、待办事项堆叠在同一空间里',
                '人物反复在资料、沟通、整理之间切换，时间被切碎',
              ],
              narration:
                '很多人以为 AI 的意义，是让机器更聪明。但对真正身处生产一线的人来说，最先感受到的，其实是旧流程到底有多重。',
              transitionToNext: '当重复劳动被充分建立后，再把 AI 作为新变量推入画面。',
            },
            {
              sectionTitle: '段落二：AI 进入现场',
              keyBeat: '让变化可见，同时保留观众对边界的疑问。',
              visuals: [
                '输入需求后，信息被快速归纳、方案被迅速生成',
                '人物从执行者短暂转为决策者，开始筛选与判断',
              ],
              narration:
                '当 AI 开始参与内容梳理、方案生成和执行辅助，变化最先发生的，不是结果，而是节奏。很多原本要来回反复的步骤，被压缩到了几分钟里。',
              transitionToNext: '继续推进，让观众看到效率之外更深的结构变化。',
            },
            {
              sectionTitle: '段落三：真正被改变的不是一步，而是一整条链路',
              keyBeat: '从效率提升上升到流程重组。',
              visuals: [
                '旧流程与新流程在画面中对照展开，岗位之间的协作关系发生变化',
                '人物不再被机械任务拖住，而是把注意力放在判断、选择与校准上',
              ],
              narration:
                '这时我们会发现，AI 改变的不是一个局部动作，而是整条生产链路。它重新分配了时间，重新定义了岗位，也重新划分了什么该交给系统，什么必须留给人。',
              transitionToNext: '把镜头和叙述都收回来，给出更成熟的判断。',
            },
            {
              sectionTitle: '段落四：新的工业革命，真正改变的是人和生产方式的关系',
              keyBeat: '回到主题，但落点必须具体而稳。',
              visuals: [
                '从个人工位拉到更大的协作空间，再切到更宏观的产业场景',
                '人物停下操作，看向已经被重构的工作环境',
              ],
              narration:
                '所以 AI 的价值，不只是多了一种更强的工具，而是它正在重新组织生产方式。真正的新工业革命，不在于机器替人完成一切，而在于人终于可以把精力从重复执行中抽离出来，回到判断、创意和责任本身。',
              transitionToNext: '结尾留给观众一个带思考空间的停顿。',
            },
          ],
        },
        outputMarkdown: [
          '## 片子定位',
          '这是一支以“AI 是否构成新的工业革命”为核心命题的观点型叙事短片，不直接堆结论，而是通过具体工作场景逐步完成认知抬升。',
          '',
          '## 成片目标',
          line('先让观众看到旧流程为什么沉重。'),
          line('再展示 AI 进入后流程、角色与效率的变化。'),
          line('最后把结论落到“生产方式被重组”而不是“工具更强”。'),
          '',
          '## 分段脚本',
          '### 段落一：旧流程的重量',
          '画面：清晨的工位、碎片化沟通、反复整理资料的动作不断出现。',
          '旁白：很多人以为 AI 的意义，是让机器更聪明。但对真正身处生产一线的人来说，最先感受到的，其实是旧流程到底有多重。',
          '',
          '### 段落二：AI 进入现场',
          '画面：需求被输入系统后，方案快速出现，人物开始从执行切到判断。',
          '旁白：当 AI 开始参与内容梳理、方案生成和执行辅助，变化最先发生的，不是结果，而是节奏。',
          '',
          '### 段落三：真正被改变的是整条链路',
          '画面：旧流程和新流程交叉对照，协作关系被重新组织。',
          '旁白：这时我们会发现，AI 改变的不是一个局部动作，而是整条生产链路。',
          '',
          '### 段落四：新的工业革命，改变的是人与生产方式的关系',
          '画面：镜头从个人工位拉向更大的协作空间，再切向产业级图景。',
          '旁白：真正的新工业革命，不在于机器替人完成一切，而在于人终于可以把精力从重复执行中抽离出来。',
          '',
          line(`当前版本${revisionBrief ? `已尝试回应修订要求：${revisionBrief}` : '可直接继续进入 shot 拆解阶段。'}`),
        ].join('\n'),
        outputSummary: '完成最终脚本',
        promptVersion: 'v1',
        providerName: 'mock',
        modelName: input.modelBinding?.modelName ?? 'mock-llm',
      };
    case 'agent5':
      return {
        outputJson: { reviewer: 'balanced' },
        outputMarkdown: '## 审核\nAgent5 负责给出平衡型审核结论。',
        outputSummary: '生成审核结果',
        promptVersion: 'v1',
        providerName: 'mock',
        modelName: input.modelBinding?.modelName ?? 'mock-llm',
      };
    case 'agent6':
      return {
        outputJson: {
          scenes: [
            {
              title: 'Scene 1: 建立背景',
              sceneDesc: '先建立现实情境和人物所面对的旧流程压力。',
              shots: [
                {
                  title: 'S1-1 压力建立',
                  scriptSegment: '先让观众看到旧流程为什么沉重。',
                  subjectDesc: '堆满任务与资料的工作台',
                  actionDesc: '人物在多个任务之间来回切换，动作频繁但产出缓慢',
                  moodDesc: '压抑、疲惫',
                  continuityNotes: '作为开场镜头，建立旧流程的重量感',
                },
                {
                  title: 'S1-2 旧流程细节',
                  scriptSegment: '让观众理解问题不是抽象概念，而是具体工作方式。',
                  subjectDesc: '屏幕、纸稿、消息通知交织的细节',
                  actionDesc: '镜头快速切换资料整理、重复修改和沟通等待',
                  moodDesc: '忙碌、低效',
                  continuityNotes: '接 S1-1，继续放大旧流程的摩擦成本',
                },
              ],
            },
            {
              title: 'Scene 2: AI 进入现场',
              sceneDesc: '让新变量进入系统，展示工作节奏开始变化。',
              shots: [
                {
                  title: 'S2-1 AI 介入',
                  scriptSegment: '当 AI 开始参与内容梳理、方案生成和执行辅助，变化最先发生的，是节奏。',
                  subjectDesc: '人机协作界面与快速成形的方案',
                  actionDesc: '输入需求后，系统迅速生成结构化结果，人物开始筛选与判断',
                  moodDesc: '惊讶、期待',
                  continuityNotes: '从旧流程切到新变量，形成明确对照',
                },
                {
                  title: 'S2-2 决策切换',
                  scriptSegment: '人物从执行者短暂转为决策者。',
                  subjectDesc: '人物从键盘操作转向审阅、选择与校准',
                  actionDesc: '镜头聚焦人物视线、手势和界面之间的互动',
                  moodDesc: '专注、谨慎',
                  continuityNotes: '接 S2-1，强调角色职责正在变化',
                },
              ],
            },
            {
              title: 'Scene 3: 链路重组',
              sceneDesc: '从单点效率提升上升到整条生产链路被重组。',
              shots: [
                {
                  title: 'S3-1 流程重组',
                  scriptSegment: 'AI 改变的不是一个局部动作，而是整条生产链路。',
                  subjectDesc: '旧流程与新流程的并置对照',
                  actionDesc: '多个岗位与环节被快速串联，协作节奏明显提速',
                  moodDesc: '张力上升',
                  continuityNotes: '承接 Scene 2，把变化扩大到系统层面',
                },
                {
                  title: 'S3-2 观点收束',
                  scriptSegment: '真正的新工业革命，不在于机器替人完成一切，而在于人重新回到判断、创意和责任。',
                  subjectDesc: '人物重新站回决策位置，看向更大的协作空间',
                  actionDesc: '镜头从个人工位拉向更广阔的生产环境',
                  moodDesc: '开阔、坚定',
                  continuityNotes: '作为结尾镜头，收束前文并完成观点落点',
                },
              ],
            },
          ],
        },
        outputMarkdown: [
          '## 场景拆解',
          line('Scene 1 建立旧流程压力，先让问题可见。'),
          line('Scene 2 引入 AI 变量，展示角色和节奏变化。'),
          line('Scene 3 放大到链路重组，并完成观点收束。'),
          '',
          '## Shot 列表',
          line('共拆出 3 个 scene，6 个 shot。'),
          line('每个 shot 都对应一个独立关键画面，而不是简单按段落一刀切。'),
          '',
          '## 连贯性说明',
          line('通过“旧流程 -> AI 介入 -> 链路重组”的节奏推进，让 scene 数和 shot 数服务于叙事需要。'),
        ].join('\n'),
        outputSummary: '完成场景与 shot 抽取',
        promptVersion: 'v1',
        providerName: 'mock',
        modelName: input.modelBinding?.modelName ?? 'mock-llm',
      };
    case 'agent7':
      {
        const inputShots = Array.isArray(input.context?.shots)
          ? input.context.shots.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          : [];

        const shotExpansions =
          inputShots.length > 0
            ? inputShots.map((shot, index) => ({
                shotIndexGlobal:
                  typeof shot.shotIndexGlobal === 'number' ? shot.shotIndexGlobal : index + 1,
                shotTitle:
                  typeof shot.title === 'string' && shot.title.trim().length > 0
                    ? shot.title
                    : `Shot ${index + 1}`,
                scriptSegment:
                  typeof shot.scriptSegment === 'string' ? shot.scriptSegment : '沿用原脚本推进当前镜头。',
                subjectDesc:
                  typeof shot.subjectDesc === 'string' ? shot.subjectDesc : '主体保持与上游镜头一致',
                actionDesc:
                  typeof shot.actionDesc === 'string' ? shot.actionDesc : '镜头围绕当前主体完成关键动作',
                mood: typeof shot.moodDesc === 'string' ? shot.moodDesc : '理性、聚焦、可执行',
                continuityNotes:
                  typeof shot.continuityNotes === 'string'
                    ? shot.continuityNotes
                    : '保持与前后 shot 的人物、道具与叙事节奏一致',
                visualPrompt: `电影级关键分镜，${typeof shot.subjectDesc === 'string' ? shot.subjectDesc : '主体清晰可辨'}，${typeof shot.actionDesc === 'string' ? shot.actionDesc : '完成当前叙事动作'}，${typeof shot.moodDesc === 'string' ? shot.moodDesc : '情绪稳定连贯'}，统一的财经纪实视觉风格，画面可直接用于 AI 生图。`,
                lighting: '冷暖对比的财经纪实打光，主体边缘有清晰轮廓光',
                cameraMotion: '中景到近景的稳态推进，保留画面信息密度',
                compositionNotes: '主体居中偏三分法，预留图表或字幕叠加空间',
                styleNotes: '巫师财经风格，数据可视化与人物叙事并存',
              }))
            : [
                {
                  shotIndexGlobal: 1,
                  shotTitle: '默认扩写 shot',
                  scriptSegment: '沿用原脚本推进当前镜头。',
                  subjectDesc: '主体清晰可辨',
                  actionDesc: '完成当前叙事动作',
                  mood: '理性、聚焦、可执行',
                  continuityNotes: '保持与前后 shot 的人物、道具与叙事节奏一致',
                  visualPrompt: '电影级关键分镜，主体清晰可辨，动作明确，情绪稳定连贯，统一的财经纪实视觉风格，画面可直接用于 AI 生图。',
                  lighting: '冷暖对比的财经纪实打光，主体边缘有清晰轮廓光',
                  cameraMotion: '中景到近景的稳态推进，保留画面信息密度',
                  compositionNotes: '主体居中偏三分法，预留图表或字幕叠加空间',
                  styleNotes: '巫师财经风格，数据可视化与人物叙事并存',
                },
              ];

      return {
        outputJson: {
          shotExpansions,
        },
        outputMarkdown: [
          '## 扩写原则',
          line('保持上游脚本信息密度，并把内容压成可直接给生图模型使用的 prompt。'),
          '',
          '## Shot 扩写结果',
          line(`已扩写 ${shotExpansions.length} 个 shot，供下游 Agent8 直接使用。`),
        ].join('\n'),
        outputSummary: '完成 shot 扩写',
        promptVersion: 'v1',
        providerName: 'mock',
        modelName: input.modelBinding?.modelName ?? 'mock-llm',
      };
      }
    case 'agent8':
      return {
        outputJson: {
          generated: 'storyboard_assets',
        },
        outputMarkdown: '## 分镜图生成\n已为当前 shot 生成关键分镜图占位版本。',
        outputSummary: '完成关键分镜图生成',
        promptVersion: 'v1',
        providerName: 'mock',
        modelName: input.modelBinding?.modelName ?? 'mock-image',
      };
    case 'agent9':
      return {
        outputJson: {
          generated: 'video_assets',
        },
        outputMarkdown: '## 视频片段生成\n已为当前 shot 生成视频片段占位版本。',
        outputSummary: '完成视频片段生成',
        promptVersion: 'v1',
        providerName: 'mock',
        modelName: input.modelBinding?.modelName ?? 'mock-video',
      };
    default:
      return {
        outputJson: {},
        outputMarkdown: '## 未知 Agent',
        outputSummary: '未知 Agent',
        promptVersion: 'v1',
        providerName: 'mock',
        modelName: input.modelBinding?.modelName ?? 'mock',
      };
  }
}
