import {
  ensureDb,
  manualGateRepository,
} from '@video-agent-studio/db';
import { scriptConfirmSchema } from '@video-agent-studio/shared';
import { jsonFail, jsonOk, readJsonStrict } from '../../../../../../lib/http';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await ensureDb();
  const { projectId } = await params;
  const body = await readJsonStrict(request);
  if (!body.success) {
    return body.response;
  }
  const parsed = scriptConfirmSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonFail('INVALID_WORKFLOW_INPUT', '请选择要确认的最终脚本版本', 400, {
      issues: parsed.error.issues,
    });
  }

  const result = await manualGateRepository.confirmFinalScript(
    projectId,
    parsed.data.taskId,
  );
  if (!result.ok) {
    switch (result.reason) {
      case 'project_not_found':
        return jsonFail('PROJECT_NOT_FOUND', '项目不存在', 404);
      case 'script_version_not_approved':
        return jsonFail(
          'SCRIPT_VERSION_NOT_APPROVED',
          '只能确认当前项目中已通过审核的 Agent4 最终脚本',
          409,
        );
      case 'stale_script_version':
        return jsonFail(
          'STALE_SCRIPT_VERSION',
          '该脚本不是当前工作流的最新版本，请刷新后重新确认',
          409,
        );
      case 'agent1_gate_evidence_missing':
        return jsonFail(
          'MANUAL_GATE_PREREQUISITE_MISSING',
          '当前脚本使用的创作设定已变化或缺少确认凭据，请先确认设定并重新生成脚本',
          409,
        );
      case 'manual_gate_not_ready':
        return jsonFail(
          'MANUAL_GATE_NOT_READY',
          '当前脚本工作流尚未到达用户确认节点',
          409,
        );
    }
  }

  return jsonOk({
    confirmed: true,
    runId: result.runId,
    nextStage: result.nextStage,
    alreadyConfirmed: result.alreadyConfirmed,
  });
}
