export const controlPlaneObjectTypes = ['shot', 'storyboard', 'video', 'key_element', 'key-element'] as const;

export const canonicalControlPlaneObjectTypes = ['shot', 'storyboard', 'video', 'key_element'] as const;

export type ControlPlaneObjectType = (typeof controlPlaneObjectTypes)[number];
export type CanonicalControlPlaneObjectType = (typeof canonicalControlPlaneObjectTypes)[number];

export const controlPlaneChangeTypes = [
  'replace',
  'update',
  'regenerate',
  'delete',
  'reorder',
  'lock',
  'unlock',
] as const;

export type ControlPlaneChangeType = (typeof controlPlaneChangeTypes)[number];

export function normalizeControlPlaneObjectType(objectType: ControlPlaneObjectType): CanonicalControlPlaneObjectType {
  return objectType === 'key-element' ? 'key_element' : objectType;
}

export function normalizeControlPlaneChangeType(changeType: string): string {
  return changeType.trim().toLowerCase();
}
