import { settingsRepository } from '@video-agent-studio/db';

export async function bootstrapProjectSettings(projectId: string) {
  await settingsRepository.ensureDefaults(projectId);
}
