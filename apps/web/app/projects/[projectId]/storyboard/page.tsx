import { notFound } from 'next/navigation';
import type { ShotWithAssets } from '@video-agent-studio/shared';
import { ShotWorkbench } from '@/components/shot-workbench';
import { getProjectContext, getStoryboardPageData } from '@/lib/server-data';

export default async function StoryboardWorkbenchPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ shot?: string }>;
}) {
  const { projectId } = await params;
  const { shot: initialShotId } = await searchParams;
  const context = await getProjectContext(projectId);
  const data = await getStoryboardPageData(projectId);
  if (!context) {
    notFound();
  }

  const shotCountBySceneId = new Map<string, number>();
  for (const shot of data.shots) {
    const sceneId = shot.sceneId ?? '';
    if (!sceneId) {
      continue;
    }
    shotCountBySceneId.set(sceneId, (shotCountBySceneId.get(sceneId) ?? 0) + 1);
  }

  return (
    <>
      <section className="hero">
        <p className="hero-eyebrow">项目工具 · 结构编辑</p>
        <h1 className="page-title">Shot 结构</h1>
        <p>
          编辑镜头文本、视觉提示与顺序。分镜图、视频和版本操作统一在 Shot
          制作台完成。
        </p>
        <div className="inline-actions">
          <span className="pill active">{data.scenes.length} 个 Scene</span>
          <span className="pill active">{data.shots.length} 个 Shot</span>
        </div>
      </section>

      <details className="card disclosure-card scene-outline">
        <summary>
          <span>
            <strong>场景大纲</strong>
            <small>查看 Scene 与 Agent6/7 生成规则</small>
          </span>
          <span>{data.scenes.length} 个 Scene</span>
        </summary>
        <div className="scene-outline-content">
          <div className="sidebar-list">
            {data.scenes.map((scene) => (
              <div key={scene.id} className="list-row">
                <strong>
                  Scene {scene.sceneIndex} · {scene.title}
                </strong>
                <div className="subtle">
                  {shotCountBySceneId.get(scene.id) ?? 0} 个 shot ·{' '}
                  {scene.sceneDesc}
                </div>
              </div>
            ))}
          </div>
          <div className="guidance-note">
            <strong>版本与写入边界</strong>
            <p>
              Agent6 负责结构化拆分，Agent7 只创建增强版本，不覆盖原始输出；锁定
              Shot 只能查看，不能被自动改写。
            </p>
          </div>
        </div>
      </details>

      <ShotWorkbench
        key={initialShotId ?? 'default'}
        initialShotId={initialShotId}
        projectId={projectId}
        shots={data.shots as ShotWithAssets[]}
      />
    </>
  );
}
