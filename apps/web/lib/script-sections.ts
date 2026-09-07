export type ScriptSection = {
  sectionTitle: string;
  narration: string;
  visuals: string;
  keyBeat: string;
  transitionToNext: string;
};

/** Display only strings from provider output; never coerce objects or render HTML. */
export function readScriptSections(
  output: Record<string, unknown>,
): ScriptSection[] {
  if (!Array.isArray(output.scriptSections)) return [];
  return output.scriptSections.flatMap((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const section = value as Record<string, unknown>;
    const read = (key: string) =>
      typeof section[key] === 'string' ? (section[key] as string) : '';
    if (!read('narration') && !read('visuals')) return [];
    return [
      {
        sectionTitle: read('sectionTitle') || `段落 ${index + 1}`,
        narration: read('narration'),
        visuals: read('visuals'),
        keyBeat: read('keyBeat'),
        transitionToNext: read('transitionToNext'),
      },
    ];
  });
}
