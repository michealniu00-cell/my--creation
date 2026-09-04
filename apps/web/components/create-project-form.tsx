'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function CreateProjectForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    title: '',
    sourceIdea: '',
    targetPlatform: 'douyin',
    language: 'zh-CN',
  });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    });
    const payload = await response.json();
    setLoading(false);
    if (payload.success) {
      router.push(`/projects/${payload.data.projectId}/agent1`);
      router.refresh();
    }
  }

  return (
    <form className="card grid" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="title">项目标题</label>
        <input id="title" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
      </div>
      <div className="field">
        <label htmlFor="idea">原始灵感</label>
        <textarea
          id="idea"
          value={form.sourceIdea}
          onChange={(event) => setForm((current) => ({ ...current, sourceIdea: event.target.value }))}
        />
      </div>
      <div className="grid two">
        <div className="field">
          <label htmlFor="platform">目标平台</label>
          <select
            id="platform"
            value={form.targetPlatform}
            onChange={(event) => setForm((current) => ({ ...current, targetPlatform: event.target.value }))}
          >
            <option value="douyin">抖音</option>
            <option value="xiaohongshu">小红书</option>
            <option value="tiktok">TikTok</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="language">语言</label>
          <input
            id="language"
            value={form.language}
            onChange={(event) => setForm((current) => ({ ...current, language: event.target.value }))}
          />
        </div>
      </div>
      <div className="actions">
        <button className="button" type="submit" disabled={loading}>
          {loading ? '创建中...' : '创建项目并进入 Agent1'}
        </button>
      </div>
    </form>
  );
}

