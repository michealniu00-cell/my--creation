import { notFound } from 'next/navigation';
import { getProjectContext, getTimelinePageData } from '@/lib/server-data';
import { formatDate } from '@/lib/format';
import { ArtifactVersionPanel } from '@/components/artifact-version-panel';
import { KeyElementRegenerateButton, KeyElementUploadForm } from '@/components/key-element-tools';

export default async function KeyElementsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const context = await getProjectContext(projectId);
  const data = await getTimelinePageData(projectId);
  if (!context) {
    notFound();
  }

  return (
    <>
      <section className="hero">
        <p className="hero-eyebrow">项目工具 · Reference assets</p>
        <h1 className="page-title">关键要素</h1>
        <p>集中管理角色、场景、道具、风格与特效参考图；切换版本前会先显示受影响的 Shot。</p>
      </section>

      <KeyElementUploadForm projectId={projectId} />

      <section className="grid two">
        {data.keyElements.map((item) => (
          <div key={item.id} className="card">
            <div className="toolbar">
              <div>
                <h2 className="card-title">{item.name}</h2>
                <div className="subtle">{item.role}</div>
              </div>
              <div className="inline-actions">
                <span className="subtle">引用 {item.referencedShotIds.length} 个 shot</span>
                <KeyElementRegenerateButton artifactGroupId={item.id} />
              </div>
            </div>
            <ArtifactVersionPanel
              title={item.name ?? '关键要素图'}
              projectId={projectId}
              groupId={item.id}
              previewUrl={item.activeVersion?.publicUrl}
              previewType="image"
              currentVersionId={item.activeVersion?.id}
              currentVersionNote={`当前生效版本：v${item.activeVersion?.versionNo ?? 0} · ${formatDate(item.activeVersion?.updatedAt)}`}
              activationObjectType="key_element"
              activateEndpoint={`/api/key-elements/${item.id}/activate-version`}
              emptyHint="当前关键要素图暂未上传版本"
              compact
            />
            <p className="subtle">切换关键要素版本前，系统会先分析受影响的 shot 和潜在冲突，再由你确认是否继续。</p>
            <div className="timeline">
              {item.referencedShotIds.map((shotId) => (
                <div key={shotId} className="list-row">
                  {shotId}
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
