import { describe, expect, it } from 'vitest';
import { buildStoryboardImagePrompt } from './storyboard-prompt';

describe('buildStoryboardImagePrompt', () => {
  it('keeps MiniMax storyboard prompts within the safety limit while preserving key shot information', () => {
    const prompt = buildStoryboardImagePrompt(
      '什么是ai，ai是第三次工业革命吗',
      {
        title: '历史引入：达特茅斯会议',
        scriptSegment:
          '左侧40%区域：深灰/深蓝背景信息板，横向AI发展时间轴；时间轴起点节点标注“1956 达特茅斯会议”，节点以金色脉冲圆圈高亮闪烁，向右延伸的轨迹线为浅灰色未激活态。右侧60%区域：博主正中画面，圆角矩形边框，博主正对镜头口播，上方保留细条状标题栏（可选：节目名称小字）。',
        sceneDesc:
          '此镜头用于正式引入AI历史坐标系，需要同时呈现时间线信息板与口播人物，不能丢失年份、事件名称、左右分栏比例和版面顺序。',
        subjectDesc:
          '主持人口播特写、1956达特茅斯会议节点、AI发展时间轴、深蓝信息板、浅灰轨迹线、金色脉冲圆圈。',
        actionDesc:
          '左侧时间轴节点轻微发光，右侧主持人正对镜头稳定讲述，标题栏保持细窄横条，不喧宾夺主。',
        moodDesc: '理性、历史感、信息密度高',
        visualPrompt:
          '必须清楚呈现左右40/60分栏、1956达特茅斯会议节点、金色高亮脉冲、博主口播主体、顶部细标题栏与信息阅读顺序。',
        compositionNotes:
          '左侧信息板先读时间轴和1956节点，再读右侧博主主体；标题栏在最上方细条区域；所有文字元素保持清晰可读，节点与轨迹线不要被人物遮挡。',
        lighting: '深蓝科技感环境光，人物脸部保持自然补光',
        cameraMotion: '近乎静止的稳定镜头',
        styleNotes: '商业口播+科技信息图混合视觉',
        continuityNotes: '与上下镜头保持同一主题，但不得牺牲当前镜头的时间线与文字布局。',
      },
      {
        promptHint: '确保1956和达特茅斯会议字样准确显示，排版不要被装饰元素覆盖。',
      },
    );

    expect(prompt.length).toBeLessThanOrEqual(1450);
    expect(prompt).toContain('历史引入：达特茅斯会议');
    expect(prompt).toContain('1956');
    expect(prompt).toContain('构图排版');
  });
});
