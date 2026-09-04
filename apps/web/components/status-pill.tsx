export function StatusPill({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  // Workflow enums use snake_case while some legacy presentation values use
  // spaces or kebab-case. Normalize all three forms so internal enum names
  // never leak into the interface.
  const normalized = value.toLowerCase().replace(/[\s_]+/g, '-');
  const labelMap: Record<string, string> = {
    draft: '草稿',
    running: '进行中',
    reviewing: '待确认',
    completed: '已完成',
    approved: '已通过',
    pass: '审核通过',
    revise: '需要修改',
    active: '已生效',
    pending: '处理中',
    paused: '已暂停',
    failed: '失败',
    error: '异常',
    placeholder: '占位版本',
    'not-started': '未开始',
    'in-progress': '制作中',
    'awaiting-confirmation': '待确认',
    'needs-attention': '需处理',
    script: '脚本阶段',
    storyboard: '分镜阶段',
    video: '视频阶段',
  };
  const label = labelMap[normalized] ?? value;

  return (
    <span className={['pill', normalized, className].filter(Boolean).join(' ')}>
      {label}
    </span>
  );
}
