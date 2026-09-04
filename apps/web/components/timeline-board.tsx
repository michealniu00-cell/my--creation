'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { ShotWithAssets } from '@video-agent-studio/shared';
import { ArtifactVersionPanel } from '@/components/artifact-version-panel';
import { ControlPlaneActionButton } from '@/components/control-plane-action-button';

type TimelineShot = ShotWithAssets;

export function TimelineBoard({
  projectId,
  shots,
}: {
  projectId: string;
  shots: TimelineShot[];
}) {
  const router = useRouter();
  const boardRef = useRef<HTMLDivElement>(null);
  const hasPendingProcessing = shots.some(
    (shot) =>
      shot.assets?.storyboardMain?.processingVersion?.status === 'pending' ||
      shot.assets?.videoMain?.processingVersion?.status === 'pending',
  );
  const storyboardCount = shots.filter((shot) =>
    Boolean(shot.assets?.storyboardMain?.url),
  ).length;
  const videoCount = shots.filter(
    (shot) =>
      Boolean(shot.assets?.videoMain?.url) &&
      !shot.assets?.videoMain?.isPlaceholder,
  ).length;
  const attentionCount = shots.filter(
    (shot) =>
      shot.assets?.storyboardMain?.processingVersion?.status === 'failed' ||
      shot.assets?.videoMain?.processingVersion?.status === 'failed',
  ).length;

  useEffect(() => {
    if (!hasPendingProcessing) {
      return;
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        router.refresh();
      }
    };
    const timer = window.setInterval(refreshWhenVisible, 5000);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [hasPendingProcessing, router]);

  function moveBoard(direction: -1 | 1) {
    const board = boardRef.current;
    if (!board) {
      return;
    }
    board.scrollBy({
      left: direction * Math.max(280, board.clientWidth * 0.82),
      behavior: 'smooth',
    });
  }

  return (
    <div className="horizontal-board">
      <div className="workspace-toolbar">
        <div>
          <strong>{shots.length} 个 Shot</strong>
          <span>
            横向滚动或使用左右方向键逐镜头检查，卡片内从上到下完成分镜与视频。
          </span>
        </div>
        <div className="workspace-toolbar-actions">
          <div className="workspace-progress" aria-label="制作进度">
            <span>
              <strong>
                {storyboardCount}/{shots.length}
              </strong>{' '}
              分镜
            </span>
            <span>
              <strong>
                {videoCount}/{shots.length}
              </strong>{' '}
              视频
            </span>
            {attentionCount > 0 ? (
              <span className="needs-attention">
                <strong>{attentionCount}</strong> 待处理
              </span>
            ) : null}
          </div>
          {shots.length > 1 ? (
            <div className="board-navigation" aria-label="Shot 导航">
              <button
                className="button ghost small"
                type="button"
                onClick={() => moveBoard(-1)}
              >
                上一个
              </button>
              <button
                className="button ghost small"
                type="button"
                onClick={() => moveBoard(1)}
              >
                下一个
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {hasPendingProcessing ? (
        <div className="workspace-notice" role="status" aria-live="polite">
          <div className="toolbar">
            <strong>正在生成新版本</strong>
            <span className="pill pending">处理中</span>
          </div>
          <div className="subtle">
            你可以继续检查其他 Shot；完成后卡片会自动更新。
          </div>
        </div>
      ) : null}
      <div
        ref={boardRef}
        className="horizontal-board-inner"
        role="region"
        aria-label="Shot 横向制作列表"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            moveBoard(event.key === 'ArrowLeft' ? -1 : 1);
          }
        }}
      >
        {shots.map((shot) => (
          <article
            key={shot.id}
            className={`shot-card ${shot.locked ? 'is-locked' : ''}`}
            aria-label={`Shot ${shot.shotIndexGlobal} ${shot.title ?? ''}`}
          >
            <header className="shot-card-header">
              <div className="shot-title-block">
                <span>
                  SHOT {String(shot.shotIndexGlobal).padStart(2, '0')}
                </span>
                <h2>{shot.title || '未命名 Shot'}</h2>
              </div>
              <span className={`pill ${shot.locked ? 'reviewing' : 'active'}`}>
                {shot.locked ? '已锁定' : '未锁定'}
              </span>
            </header>
            {shot.subjectDesc || shot.moodDesc ? (
              <details className="shot-description">
                <summary>镜头说明</summary>
                {shot.subjectDesc ? <p>{shot.subjectDesc}</p> : null}
                {shot.moodDesc ? (
                  <p>
                    <strong>氛围：</strong>
                    {shot.moodDesc}
                  </p>
                ) : null}
              </details>
            ) : null}
            <ArtifactVersionPanel
              title="关键分镜图"
              projectId={projectId}
              groupId={shot.assets?.storyboardMain?.artifactGroupId}
              previewUrl={shot.assets?.storyboardMain?.url}
              previewType="image"
              currentVersionId={shot.assets?.storyboardMain?.activeVersionId}
              currentVersionNote={shot.assets?.storyboardMain?.versionNote}
              processingVersion={shot.assets?.storyboardMain?.processingVersion}
              activationObjectType="storyboard"
              versionLockApiSegment="storyboards"
              activateEndpoint={
                shot.assets?.storyboardMain?.artifactGroupId
                  ? `/api/storyboards/groups/${shot.assets.storyboardMain.artifactGroupId}/activate-version`
                  : null
              }
              emptyHint="尚无关键分镜图版本"
              compact
            />
            <ArtifactVersionPanel
              title="视频片段"
              projectId={projectId}
              groupId={shot.assets?.videoMain?.artifactGroupId}
              previewUrl={shot.assets?.videoMain?.url}
              previewType="video"
              currentVersionId={shot.assets?.videoMain?.activeVersionId}
              currentVersionNote={shot.assets?.videoMain?.versionNote}
              processingVersion={shot.assets?.videoMain?.processingVersion}
              activationObjectType="video"
              versionLockApiSegment="videos"
              activateEndpoint={
                shot.assets?.videoMain?.artifactGroupId
                  ? `/api/videos/groups/${shot.assets.videoMain.artifactGroupId}/activate-version`
                  : null
              }
              emptyHint={
                shot.assets?.videoMain?.isPlaceholder
                  ? '当前视频为占位片段'
                  : '尚未生成视频'
              }
              compact
            />
            <footer className="shot-card-footer">
              {shot.locked ? (
                <p>此 Shot 已锁定。解锁前不会生成或切换内容。</p>
              ) : null}
              <div className="inline-actions shot-card-actions">
                {!shot.locked ? (
                  <>
                    <ControlPlaneActionButton
                      stateKey={`${shot.id}:storyboard:${shot.assets?.storyboardMain?.activeVersionId ?? 'none'}`}
                      projectId={projectId}
                      analysisTarget={{
                        objectType: 'shot',
                        objectId: shot.id,
                        changeType: 'regenerate',
                      }}
                      request={{
                        url: `/api/shots/${shot.id}/storyboard/regenerate`,
                        method: 'POST',
                        body: {
                          promptHint:
                            '优先严格满足当前 shot 分镜描述，包括文字、内容、排版、位置与顺序；画面一致性为次级要求。',
                        },
                      }}
                      actionLabel={`重生成 shot #${shot.shotIndexGlobal} 的关键分镜图`}
                      confirmTitle="即将重生成关键分镜图"
                      confirmDescription="系统会检查该 shot、相邻镜头、当前视频片段和关键要素是否会被联动影响。"
                      className="button ghost small"
                    >
                      重做分镜
                    </ControlPlaneActionButton>
                    <ControlPlaneActionButton
                      stateKey={`${shot.id}:video:${shot.assets?.videoMain?.activeVersionId ?? 'none'}`}
                      projectId={projectId}
                      analysisTarget={{
                        objectType: 'shot',
                        objectId: shot.id,
                        changeType: 'regenerate',
                      }}
                      request={{
                        url: `/api/shots/${shot.id}/video/regenerate`,
                        method: 'POST',
                        body: { promptHint: '动作更顺滑' },
                      }}
                      actionLabel={`重生成 shot #${shot.shotIndexGlobal} 的视频片段`}
                      confirmTitle="即将重生成视频片段"
                      confirmDescription="系统会检查该片段是否会影响前后镜头衔接，以及当前分镜与视频的一致性。"
                      className="button ghost small"
                    >
                      生成视频
                    </ControlPlaneActionButton>
                  </>
                ) : null}
                <ControlPlaneActionButton
                  stateKey={`${shot.id}:lock:${shot.locked ? 'locked' : 'unlocked'}`}
                  projectId={projectId}
                  analysisTarget={{
                    objectType: 'shot',
                    objectId: shot.id,
                    changeType: shot.locked ? 'unlock' : 'lock',
                  }}
                  request={{
                    url: `/api/shots/${shot.id}/${shot.locked ? 'unlock' : 'lock'}`,
                    method: 'POST',
                    body: shot.locked
                      ? undefined
                      : { cascade: true, reason: '从联动时间线手动锁定' },
                  }}
                  actionLabel={`${shot.locked ? '解锁' : '锁定'} shot #${shot.shotIndexGlobal}`}
                  confirmTitle={
                    shot.locked ? '即将解锁当前 shot' : '即将锁定当前 shot'
                  }
                  confirmDescription="锁定状态会影响后续自动覆盖、局部重生成和版本切换策略。"
                  className="button small"
                >
                  {shot.locked ? '解锁 Shot' : '锁定 Shot'}
                </ControlPlaneActionButton>
              </div>
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}
