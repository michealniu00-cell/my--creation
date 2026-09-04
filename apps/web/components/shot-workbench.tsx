'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { ShotWithAssets } from '@video-agent-studio/shared';

type Shot = ShotWithAssets;

export function ShotWorkbench({
  projectId,
  shots,
}: {
  projectId: string;
  shots: Shot[];
}) {
  const router = useRouter();
  const ordered = useMemo(
    () => [...shots].sort((a, b) => a.shotIndexGlobal - b.shotIndexGlobal),
    [shots],
  );
  const [selectedId, setSelectedId] = useState<string | undefined>(
    ordered[0]?.id,
  );
  const selected = ordered.find((shot) => shot.id === selectedId) ?? ordered[0];
  const [form, setForm] = useState(selected);
  const [mutation, setMutation] = useState<
    'save' | 'add' | 'delete' | 'move' | null
  >(null);
  const [message, setMessage] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);
  const isDirty = Boolean(
    selected && form && JSON.stringify(form) !== JSON.stringify(selected),
  );

  useEffect(() => {
    setForm(selected);
  }, [selectedId, selected]);

  function chooseShot(shotId: string) {
    if (shotId === selectedId) return;
    if (
      isDirty &&
      !window.confirm(
        '当前 Shot 有未保存修改。离开后这些修改会丢失，仍要切换吗？',
      )
    ) {
      return;
    }
    setMessage(null);
    setSelectedId(shotId);
  }

  async function ensureSuccess(response: Response, fallback: string) {
    const payload = (await response.json().catch(() => null)) as {
      success?: boolean;
      error?: { message?: string };
    } | null;
    if (!response.ok || payload?.success === false) {
      throw new Error(payload?.error?.message ?? fallback);
    }
  }

  async function save() {
    if (!selected || selected.locked) return;
    setMutation('save');
    setMessage(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/shots/${selected.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: form?.title,
            scriptSegment: form?.scriptSegment,
            sceneDesc: form?.sceneDesc,
            subjectDesc: form?.subjectDesc,
            actionDesc: form?.actionDesc,
            moodDesc: form?.moodDesc,
            continuityNotes: form?.continuityNotes,
            visualPrompt: form?.visualPrompt,
            lighting: form?.lighting,
            cameraMotion: form?.cameraMotion,
            compositionNotes: form?.compositionNotes,
            styleNotes: form?.styleNotes,
          }),
        },
      );
      await ensureSuccess(response, '保存 Shot 失败。');
      setMessage({
        tone: 'success',
        text: 'Shot 已保存，其他 Shot 未受影响。',
      });
      router.refresh();
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : '保存 Shot 失败。',
      });
    } finally {
      setMutation(null);
    }
  }

  async function addShot() {
    setMutation('add');
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/shots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          insertAfterShotId: selected?.id,
          title: '新增过渡镜头',
          scriptSegment: '由用户补充的过渡镜头。',
          sceneDesc: '自动插入过渡场景',
          subjectDesc: '转场主体',
          actionDesc: '镜头平移',
          moodDesc: '连接前后镜头',
          continuityNotes: '注意与相邻 shot 的连续性',
          visualPrompt:
            '过渡镜头，优先准确表达当前 shot 的内容、文字、排版、位置和阅读顺序，再考虑整体一致性。',
          lighting: '与前后镜头保持一致',
          cameraMotion: '平移过渡',
          compositionNotes:
            '明确主次信息、元素位置、留白和阅读顺序，如有文字需写清排版层级。',
          styleNotes: '在不损伤当前 shot 描述的前提下延续全片风格',
        }),
      });
      await ensureSuccess(response, '新增 Shot 失败。');
      setMessage({ tone: 'success', text: '已在当前位置后新增一个 Shot。' });
      router.refresh();
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : '新增 Shot 失败。',
      });
    } finally {
      setMutation(null);
    }
  }

  async function removeShot(shotId: string) {
    const shot = ordered.find((item) => item.id === shotId);
    if (
      !shot ||
      shot.locked ||
      !window.confirm(
        `确定删除 Shot #${shot.shotIndexGlobal}「${shot.title ?? '未命名'}」吗？此操作会保留事件记录，但会从当前工作台移除该 Shot。`,
      )
    ) {
      return;
    }
    setMutation('delete');
    setMessage(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/shots/${shotId}`,
        { method: 'DELETE' },
      );
      await ensureSuccess(response, '删除 Shot 失败。');
      setSelectedId(ordered.find((item) => item.id !== shotId)?.id);
      setMessage({ tone: 'success', text: 'Shot 已从当前结构中移除。' });
      router.refresh();
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : '删除 Shot 失败。',
      });
    } finally {
      setMutation(null);
    }
  }

  async function move(direction: -1 | 1) {
    if (!selected || selected.locked) return;
    const currentIndex = ordered.findIndex((shot) => shot.id === selected.id);
    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= ordered.length) return;
    const next = [...ordered];
    const [item] = next.splice(currentIndex, 1);
    next.splice(targetIndex, 0, item);

    setMutation('move');
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/shots/reorder`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderedShotIds: next.map((shot) => shot.id),
        }),
      });
      await ensureSuccess(response, '移动 Shot 失败。');
      setMessage({ tone: 'success', text: 'Shot 顺序已更新。' });
      router.refresh();
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : '移动 Shot 失败。',
      });
    } finally {
      setMutation(null);
    }
  }

  return (
    <div className="shot-structure-workbench">
      <div className="workspace-toolbar">
        <div>
          <strong>Shot 结构编辑</strong>
          <span>
            这里修改镜头文字和顺序；分镜与视频版本请在 Shot 制作台处理。
          </span>
        </div>
        <div className="workspace-progress">
          <span>
            <strong>{ordered.length}</strong> 个 Shot
          </span>
          {isDirty ? (
            <span className="needs-attention">有未保存修改</span>
          ) : null}
        </div>
      </div>
      {message ? (
        <p
          className={
            message.tone === 'error'
              ? 'form-message error'
              : 'form-message success'
          }
          role={message.tone === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {message.text}
        </p>
      ) : null}
      <div className="split shot-structure-layout">
        <div className="panel sidebar-list">
          {ordered.map((shot) => (
            <button
              key={shot.id}
              type="button"
              className={`list-row selectable-row ${shot.id === selected?.id ? 'selected' : ''}`}
              onClick={() => chooseShot(shot.id)}
              aria-pressed={shot.id === selected?.id}
            >
              <strong>
                #{shot.shotIndexGlobal} {shot.title}
              </strong>
              <div className="subtle">
                {shot.locked ? '已锁定 · ' : ''}
                {shot.sceneDesc}
              </div>
            </button>
          ))}
        </div>
        <div className="horizontal-board">
          <div className="horizontal-board-inner">
            {ordered.map((shot) => (
              <div key={shot.id} className="shot-card">
                <div className="toolbar">
                  <strong>
                    #{shot.shotIndexGlobal} {shot.title}
                  </strong>
                  <span
                    className={`pill ${shot.locked ? 'reviewing' : 'active'}`}
                  >
                    {shot.locked ? '已锁定' : '可编辑'}
                  </span>
                </div>
                <div className="subtle">{shot.subjectDesc}</div>
                <div className="inline-actions">
                  <button
                    className="button ghost small"
                    type="button"
                    onClick={() => chooseShot(shot.id)}
                  >
                    编辑详情
                  </button>
                  <button
                    className="button ghost small"
                    type="button"
                    onClick={() => void removeShot(shot.id)}
                    disabled={shot.locked || mutation !== null}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          {selected ? (
            <div className="grid" aria-busy={mutation !== null}>
              <div className="toolbar">
                <div>
                  <p className="hero-eyebrow">
                    Shot {String(selected.shotIndexGlobal).padStart(2, '0')}
                  </p>
                  <h3 className="card-title">镜头详情</h3>
                </div>
                <span
                  className={`pill ${selected.locked ? 'reviewing' : 'active'}`}
                >
                  {selected.locked ? '只读' : isDirty ? '未保存' : '已保存'}
                </span>
              </div>
              {selected.locked ? (
                <div className="guidance-note">
                  <strong>此 Shot 已锁定</strong>
                  <p>你仍可查看全部内容，但解锁前不能编辑、删除或调整顺序。</p>
                </div>
              ) : null}
              <fieldset
                className="shot-editor-fields"
                disabled={selected.locked || mutation !== null}
              >
                <div className="field">
                  <label htmlFor={`shot-${selected.id}-title`}>标题</label>
                  <input
                    id={`shot-${selected.id}-title`}
                    value={form?.title ?? ''}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current!,
                        title: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor={`shot-${selected.id}-script`}>
                    对应脚本片段
                  </label>
                  <textarea
                    id={`shot-${selected.id}-script`}
                    value={form?.scriptSegment ?? ''}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current!,
                        scriptSegment: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor={`shot-${selected.id}-scene`}>场景描述</label>
                  <textarea
                    id={`shot-${selected.id}-scene`}
                    value={form?.sceneDesc ?? ''}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current!,
                        sceneDesc: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor={`shot-${selected.id}-subject`}>
                    主体描述
                  </label>
                  <textarea
                    id={`shot-${selected.id}-subject`}
                    value={form?.subjectDesc ?? ''}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current!,
                        subjectDesc: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor={`shot-${selected.id}-action`}>动作描述</label>
                  <textarea
                    id={`shot-${selected.id}-action`}
                    value={form?.actionDesc ?? ''}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current!,
                        actionDesc: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor={`shot-${selected.id}-mood`}>氛围描述</label>
                  <textarea
                    id={`shot-${selected.id}-mood`}
                    value={form?.moodDesc ?? ''}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current!,
                        moodDesc: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor={`shot-${selected.id}-continuity`}>
                    前后衔接说明
                  </label>
                  <textarea
                    id={`shot-${selected.id}-continuity`}
                    value={form?.continuityNotes ?? ''}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current!,
                        continuityNotes: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor={`shot-${selected.id}-visual-prompt`}>
                    Visual Prompt
                  </label>
                  <textarea
                    id={`shot-${selected.id}-visual-prompt`}
                    value={form?.visualPrompt ?? ''}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current!,
                        visualPrompt: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor={`shot-${selected.id}-lighting`}>光线</label>
                  <textarea
                    id={`shot-${selected.id}-lighting`}
                    value={form?.lighting ?? ''}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current!,
                        lighting: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor={`shot-${selected.id}-camera`}>镜头运动</label>
                  <textarea
                    id={`shot-${selected.id}-camera`}
                    value={form?.cameraMotion ?? ''}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current!,
                        cameraMotion: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor={`shot-${selected.id}-composition`}>
                    构图 / 文字排版 / 位置顺序说明
                  </label>
                  <textarea
                    id={`shot-${selected.id}-composition`}
                    value={form?.compositionNotes ?? ''}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current!,
                        compositionNotes: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor={`shot-${selected.id}-style`}>风格说明</label>
                  <textarea
                    id={`shot-${selected.id}-style`}
                    value={form?.styleNotes ?? ''}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current!,
                        styleNotes: event.target.value,
                      }))
                    }
                  />
                </div>
              </fieldset>
              <div className="actions">
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => void move(-1)}
                  disabled={
                    selected.locked ||
                    mutation !== null ||
                    selected.shotIndexGlobal === ordered[0]?.shotIndexGlobal
                  }
                >
                  向前移动
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => void move(1)}
                  disabled={
                    selected.locked ||
                    mutation !== null ||
                    selected.shotIndexGlobal ===
                      ordered[ordered.length - 1]?.shotIndexGlobal
                  }
                >
                  向后移动
                </button>
                <button
                  className="button ghost"
                  type="button"
                  onClick={() => void addShot()}
                  disabled={mutation !== null}
                >
                  新增 shot
                </button>
                <button
                  className="button"
                  type="button"
                  onClick={() => void save()}
                  disabled={selected.locked || mutation !== null || !isDirty}
                >
                  {mutation === 'save' ? '正在保存...' : '保存当前 Shot'}
                </button>
              </div>
            </div>
          ) : (
            <p className="subtle">当前没有 shot。</p>
          )}
        </div>
      </div>
    </div>
  );
}
