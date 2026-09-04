'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Agent1ConfigFormProps {
  projectId: string;
  initialConfig?: {
    scriptType?: string | null;
    styleDefinition?: string | null;
    researchFocus?: string | null;
    storylineStructure?: string | null;
    scriptOrganization?: string | null;
    globalConstraints?: Record<string, unknown>;
  } | null;
}

type FormMessage = { tone: 'success' | 'error'; text: string } | null;

export function Agent1ConfigForm({ projectId, initialConfig }: Agent1ConfigFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<'draft' | 'run' | null>(null);
  const [message, setMessage] = useState<FormMessage>(null);
  const [form, setForm] = useState({
    scriptType: initialConfig?.scriptType ?? '混合型',
    styleDefinition: initialConfig?.styleDefinition ?? '电影感、轻叙事',
    researchFocus: initialConfig?.researchFocus ?? '事实调研 + 内容洞察 + 可执行建议',
    storylineStructure: initialConfig?.storylineStructure ?? '场景卡片式',
    scriptOrganization: initialConfig?.scriptOrganization ?? '按场景',
    globalConstraints: JSON.stringify(initialConfig?.globalConstraints ?? { continuity: 'medium' }, null, 2),
    note: 'Agent1 确认页创建的新配置版本',
  });

  async function requestJson(url: string, init: RequestInit) {
    const response = await fetch(url, init);
    const payload = (await response.json()) as {
      success?: boolean;
      data?: { configVersionId?: string };
      error?: { message?: string };
    };
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error?.message ?? '请求未成功，请稍后重试。');
    }
    return payload;
  }

  async function saveDraft(startWorkflow = false) {
    setMessage(null);
    let constraints: Record<string, unknown>;
    try {
      constraints = JSON.parse(form.globalConstraints || '{}') as Record<string, unknown>;
    } catch {
      setMessage({ tone: 'error', text: '高级限制不是有效的 JSON，请检查逗号、引号和括号。' });
      return;
    }

    setLoading(startWorkflow ? 'run' : 'draft');
    try {
      const draftPayload = await requestJson(`/api/projects/${projectId}/config/versions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, globalConstraints: constraints }),
      });
      const configVersionId = draftPayload.data?.configVersionId;

      if (!startWorkflow) {
        setMessage({ tone: 'success', text: '新配置草稿已保存，历史版本保持不变。' });
        router.refresh();
        return;
      }

      if (!configVersionId) {
        throw new Error('配置版本创建成功，但没有返回版本标识。');
      }

      await requestJson(`/api/projects/${projectId}/config/versions/${configVersionId}/confirm`, {
        method: 'POST',
      });
      await requestJson(`/api/projects/${projectId}/workflows/script/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          configVersionId,
          startFromNode: 'agent2',
          confirmStageRegeneration: true,
        }),
      });

      router.push(`/projects/${projectId}/script`);
      router.refresh();
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : '保存失败，请稍后重试。' });
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="grid config-form" aria-busy={loading !== null}>
      <div className="field">
        <label htmlFor="script-type">脚本类型</label>
        <input id="script-type" value={form.scriptType} onChange={(event) => setForm((current) => ({ ...current, scriptType: event.target.value }))} />
      </div>
      <div className="field">
        <label htmlFor="style-definition">风格定义</label>
        <textarea
          id="style-definition"
          value={form.styleDefinition}
          onChange={(event) => setForm((current) => ({ ...current, styleDefinition: event.target.value }))}
        />
      </div>
      <div className="field">
        <label htmlFor="research-focus">调研重点</label>
        <textarea
          id="research-focus"
          value={form.researchFocus}
          onChange={(event) => setForm((current) => ({ ...current, researchFocus: event.target.value }))}
        />
      </div>
      <div className="grid two compact-fields">
        <div className="field">
          <label htmlFor="storyline-structure">故事线结构</label>
          <input
            id="storyline-structure"
            value={form.storylineStructure}
            onChange={(event) => setForm((current) => ({ ...current, storylineStructure: event.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="script-organization">脚本组织方式</label>
          <input
            id="script-organization"
            value={form.scriptOrganization}
            onChange={(event) => setForm((current) => ({ ...current, scriptOrganization: event.target.value }))}
          />
        </div>
      </div>
      <details className="advanced-field">
        <summary>高级限制</summary>
        <div className="field">
          <label htmlFor="global-constraints">全局限制条件 JSON</label>
          <p id="global-constraints-help">只在需要结构化限制时修改，例如连续性等级或禁止项。</p>
          <textarea
            id="global-constraints"
            aria-describedby="global-constraints-help"
            value={form.globalConstraints}
            onChange={(event) => setForm((current) => ({ ...current, globalConstraints: event.target.value }))}
          />
        </div>
      </details>
      {message ? (
        <p className={message.tone === 'error' ? 'form-message error' : 'form-message success'} role={message.tone === 'error' ? 'alert' : 'status'} aria-live="polite">
          {message.text}
        </p>
      ) : null}
      <div className="form-actions">
        <p>确认会创建新版本并启动脚本生成；不会覆盖旧配置。</p>
        <div className="actions">
          <button className="button secondary" type="button" onClick={() => void saveDraft(false)} disabled={loading !== null}>
            {loading === 'draft' ? '正在保存...' : '仅保存草稿'}
          </button>
          <button className="button" type="button" onClick={() => void saveDraft(true)} disabled={loading !== null}>
            {loading === 'run' ? '正在启动...' : '确认设定并生成脚本'}
          </button>
        </div>
      </div>
    </div>
  );
}
