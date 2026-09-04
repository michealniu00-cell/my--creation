'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const roleOptions = [
  { value: 'character_ref', label: '角色' },
  { value: 'scene_ref', label: '场景' },
  { value: 'prop_ref', label: '道具' },
  { value: 'style_ref', label: '风格' },
  { value: 'effect_ref', label: '特效' },
] as const;

export function KeyElementUploadForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    if (!formData.get('file')) {
      setError('请选择要上传的关键要素素材');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/key-elements/uploads`, {
        method: 'POST',
        body: formData,
      });
      const payload = (await response.json()) as { success: boolean; error?: { message?: string } };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message ?? '上传失败');
      }

      formRef.current?.reset();
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '上传失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form ref={formRef} className="card key-element-form" onSubmit={handleSubmit}>
      <div className="toolbar">
        <div>
          <h2 className="card-title">上传关键要素素材</h2>
          <div className="subtle">支持创建新的角色、场景、道具、风格或特效参考图。</div>
        </div>
      </div>
      <div className="grid two">
        <div className="field">
          <label>素材类型</label>
          <select name="role" defaultValue="character_ref">
            {roleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>名称</label>
          <input name="name" placeholder="如：主角正面设定" />
        </div>
      </div>
      <div className="field">
        <label>备注</label>
        <input name="note" placeholder="可选，说明该要素的用途或风格方向" />
      </div>
      <div className="field">
        <label>上传文件</label>
        <input name="file" type="file" accept="image/*" />
      </div>
      {error ? <div className="list-row version-error">{error}</div> : null}
      <div className="actions">
        <button className="button" type="submit" disabled={loading}>
          {loading ? '上传中...' : '上传关键要素'}
        </button>
      </div>
    </form>
  );
}

export function KeyElementRegenerateButton({
  artifactGroupId,
}: {
  artifactGroupId: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleRegenerate() {
    setLoading(true);
    try {
      await fetch(`/api/key-elements/${artifactGroupId}/regenerate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ promptHint: '增强整体一致性与参考清晰度' }),
      });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button className="button ghost small" type="button" disabled={loading} onClick={() => void handleRegenerate()}>
      {loading ? '处理中...' : '重生成'}
    </button>
  );
}
