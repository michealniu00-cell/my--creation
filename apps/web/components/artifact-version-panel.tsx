'use client';

import Image from 'next/image';
import Link from 'next/link';
// Keep server validators out of this client component's bundle.
import { isActivatableArtifactStatus } from '@video-agent-studio/shared/src/enums/status';
import { StatusPill } from './status-pill';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  ControlPlaneChangeType,
  ControlPlaneObjectType,
} from '@video-agent-studio/shared';
import { ControlPlaneActionButton } from '@/components/control-plane-action-button';
import { WorkflowJobControls } from '@/components/workflow-job-controls';
import { formatDate } from '@/lib/format';

type ArtifactVersionSummary = {
  versionId: string;
  versionNo: number;
  status: string;
  versionNote?: string | null;
  isActive: boolean;
  isLocked?: boolean;
  createdAt?: string | null;
  generatedByAgent?: string | null;
};

type ProcessingVersionSummary = {
  versionId: string;
  jobId?: string | null;
  jobUnavailable?: boolean;
  versionNo: number;
  status: string;
  versionNote?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  error?: string | null;
};

type VersionHistoryResponse = {
  artifactGroupId: string;
  activeVersionId?: string | null;
  versions: ArtifactVersionSummary[];
};

function friendlyGenerationError(message?: string | null) {
  if (!message) {
    return '生成未成功，当前可用版本保持不变。';
  }
  if (message.includes('prompt length must be less than')) {
    return '镜头描述超过模型限制。请缩短提示内容后重试。';
  }
  if (message.toLowerCase().includes('timeout')) {
    return '生成服务响应超时，请稍后重试。';
  }
  if (message.toLowerCase().includes('api key')) {
    return '生成服务尚未正确配置，请到项目设置检查连接。';
  }
  return '生成未成功。你可以重试，当前可用版本不会被覆盖。';
}

async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, init);
  const payload = (await response.json()) as {
    success: boolean;
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(
      payload.error?.message ?? `Request failed with status ${response.status}`,
    );
  }
  return payload.data;
}

export function ArtifactVersionPanel({
  title,
  projectId,
  groupId,
  previewUrl,
  previewType = 'image',
  currentVersionId,
  currentVersionNote,
  activateEndpoint,
  activationObjectType,
  activationChangeType = 'replace',
  versionLockApiSegment,
  activateLabel = '激活此版本',
  emptyHint = '暂无可展示的版本记录。',
  compact = false,
  processingVersion,
  recoveryHref,
}: {
  title: string;
  projectId?: string;
  groupId?: string | null;
  previewUrl?: string | null;
  previewType?: 'image' | 'video';
  currentVersionId?: string | null;
  currentVersionNote?: string | null;
  activateEndpoint?: string | null;
  activationObjectType?: ControlPlaneObjectType;
  activationChangeType?: ControlPlaneChangeType;
  versionLockApiSegment?: 'storyboards' | 'videos';
  activateLabel?: string;
  emptyHint?: string;
  compact?: boolean;
  processingVersion?: ProcessingVersionSummary | null;
  recoveryHref?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [versions, setVersions] = useState<ArtifactVersionSummary[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<
    string | null | undefined
  >(currentVersionId);
  const [pendingLockVersionId, setPendingLockVersionId] = useState<
    string | null
  >(null);

  useEffect(() => {
    setActiveVersionId(currentVersionId);
  }, [currentVersionId]);

  useEffect(() => {
    if (!open || !groupId) {
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchJson<VersionHistoryResponse>(
          `/api/artifacts/${groupId}/versions`,
        );
        if (!cancelled) {
          setVersions(data.versions);
          setActiveVersionId(data.activeVersionId ?? currentVersionId ?? null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : '无法加载版本历史',
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [open, groupId, currentVersionId]);

  async function activateVersion(versionId: string) {
    if (!activateEndpoint) {
      return;
    }

    setError(null);
    try {
      await fetchJson<{
        artifactGroupId?: string | null;
        activeVersionId?: string | null;
      }>(activateEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          versionId,
          expectedActiveVersionId: activeVersionId ?? null,
        }),
      });
      setActiveVersionId(versionId);
      router.refresh();
    } catch (activateError) {
      setError(
        activateError instanceof Error ? activateError.message : '激活版本失败',
      );
    }
  }

  async function toggleVersionLock(versionId: string, locked: boolean) {
    if (!versionLockApiSegment) {
      return;
    }

    setPendingLockVersionId(versionId);
    setError(null);
    try {
      const body = locked
        ? undefined
        : JSON.stringify({ reason: `${title}版本已由用户锁定` });
      await fetchJson<{ objectId?: string | null }>(
        `/api/${versionLockApiSegment}/${versionId}/${locked ? 'unlock' : 'lock'}`,
        {
          method: 'POST',
          headers: body ? { 'content-type': 'application/json' } : undefined,
          body,
        },
      );
      setVersions((current) =>
        current.map((version) =>
          version.versionId === versionId
            ? {
                ...version,
                isLocked: !locked,
              }
            : version,
        ),
      );
      router.refresh();
    } catch (lockError) {
      setError(
        lockError instanceof Error ? lockError.message : '更新锁定状态失败',
      );
    } finally {
      setPendingLockVersionId(null);
    }
  }

  const showActivate = Boolean(activateEndpoint && groupId);

  return (
    <section
      className={['version-panel', compact ? 'compact' : '']
        .filter(Boolean)
        .join(' ')}
    >
      <div className="toolbar">
        <div>
          <strong>{title}</strong>
          <div className="subtle">
            {currentVersionNote
              ? currentVersionNote
              : groupId
                ? `资源组 ${groupId.slice(0, 8)}…`
                : '未绑定资源组'}
          </div>
        </div>
        {groupId ? (
          <button
            className="button ghost small"
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
          >
            {open ? '收起版本' : '版本记录'}
          </button>
        ) : null}
      </div>

      {previewUrl ? (
        previewType === 'video' ? (
          <video
            controls
            preload="none"
            src={previewUrl}
            className="asset-preview"
          />
        ) : (
          <Image
            src={previewUrl}
            alt={title}
            className="asset-preview"
            width={1280}
            height={720}
            unoptimized
          />
        )
      ) : (
        <div className="placeholder-video version-placeholder">{emptyHint}</div>
      )}

      {processingVersion ? (
        <div
          className={[
            'list-row',
            processingVersion.status === 'failed' ? 'version-error' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          role="status"
          aria-live="polite"
        >
          <div className="toolbar">
            <strong>
              {processingVersion.status === 'pending'
                ? `${title}正在后台处理中`
                : `${title}最近一次处理失败`}
            </strong>
            <span className={`pill ${processingVersion.status}`}>
              v{processingVersion.versionNo}
            </span>
          </div>
          <div className="subtle">
            {processingVersion.status === 'failed'
              ? friendlyGenerationError(processingVersion.error)
              : '已提交生成任务。你可以继续处理其他 Shot，完成后会自动更新。'}
          </div>
          {processingVersion.error ? (
            <details className="technical-error">
              <summary>查看技术原因</summary>
              <div>{processingVersion.error}</div>
            </details>
          ) : null}
          {processingVersion.status === 'failed' &&
          recoveryHref &&
          processingVersion.error?.includes(
            'prompt length must be less than',
          ) ? (
            <Link className="shot-edit-link" href={recoveryHref}>
              修改此镜头提示内容
            </Link>
          ) : null}
          {processingVersion.jobUnavailable ? (
            <p className="control-action-error">
              旧任务无法恢复；使用当前 Shot 的重生成操作即可安全追加新版本。
            </p>
          ) : null}
          {projectId &&
          processingVersion.jobId &&
          !processingVersion.jobUnavailable ? (
            <WorkflowJobControls
              projectId={projectId}
              jobId={processingVersion.jobId}
              initialArtifactStatus={processingVersion.status}
            />
          ) : null}
        </div>
      ) : null}

      {open ? (
        <div className="version-history">
          <div className="toolbar">
            <span className="subtle">
              {activeVersionId ? '已有生效版本' : '尚未激活版本'}
            </span>
            <span className="subtle">{versions.length} 个版本</span>
          </div>

          {loading ? <div className="list-row">正在加载版本历史...</div> : null}
          {error ? <div className="list-row version-error">{error}</div> : null}
          {!loading && !error && versions.length === 0 ? (
            <div className="list-row">{emptyHint}</div>
          ) : null}

          <div className="version-list">
            {versions.map((version) => {
              const isActive =
                version.isActive || version.versionId === activeVersionId;
              const ready = isActivatableArtifactStatus(version.status);
              const canActivate = showActivate && !isActive && ready;

              return (
                <div
                  key={version.versionId}
                  className={['version-row', isActive ? 'is-active' : '']
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div className="version-row-main">
                    <div>
                      <strong>v{version.versionNo}</strong>
                      <div className="subtle">
                        {version.versionNote ?? '无版本说明'}
                      </div>
                      <div className="subtle">
                        {formatDate(version.createdAt)}
                        {version.generatedByAgent
                          ? ` · ${version.generatedByAgent}`
                          : ''}
                      </div>
                    </div>
                    <StatusPill value={processingVersion?.versionId === version.versionId && processingVersion.jobUnavailable ? 'failed' : version.status} />
                  </div>
                  <div className="version-row-actions">
                    {!ready && !isActive ? <span className="subtle">此版本尚不可用，不能切换为当前版本。</span> : null}
                    {isActive ? (
                      <span className="pill active">当前生效</span>
                    ) : null}
                    {version.isLocked ? (
                      <span className="pill reviewing">版本已锁定</span>
                    ) : null}
                    {versionLockApiSegment ? (
                      <button
                        className="button ghost small"
                        type="button"
                        disabled={pendingLockVersionId === version.versionId}
                        onClick={() =>
                          void toggleVersionLock(
                            version.versionId,
                            Boolean(version.isLocked),
                          )
                        }
                      >
                        {pendingLockVersionId === version.versionId
                          ? '处理中...'
                          : version.isLocked
                            ? '解锁版本'
                            : '锁定版本'}
                      </button>
                    ) : null}
                    {canActivate ? (
                      projectId && activationObjectType && groupId ? (
                        <ControlPlaneActionButton
                          stateKey={`${groupId}:${version.versionId}:${activeVersionId ?? 'none'}`}
                          projectId={projectId}
                          analysisTarget={{
                            objectType: activationObjectType,
                            objectId: groupId,
                            changeType: activationChangeType,
                          }}
                          request={{
                            url: activateEndpoint!,
                            method: 'POST',
                            body: {
                              versionId: version.versionId,
                              expectedActiveVersionId: activeVersionId ?? null,
                            },
                          }}
                          actionLabel={`${title}切换到 v${version.versionNo}`}
                          confirmTitle={`${title}将切换到 v${version.versionNo}`}
                          confirmDescription="系统会先分析影响范围，再由你决定是否继续切换当前生效版本。"
                          className="button secondary small"
                          onSuccess={() =>
                            setActiveVersionId(version.versionId)
                          }
                        >
                          {activateLabel}
                        </ControlPlaneActionButton>
                      ) : (
                        <button
                          className="button secondary small"
                          type="button"
                          onClick={() =>
                            void activateVersion(version.versionId)
                          }
                        >
                          {activateLabel}
                        </button>
                      )
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
