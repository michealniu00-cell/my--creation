export function runDetached(task: () => Promise<void>, label = 'background-task') {
  setTimeout(() => {
    void task().catch((error) => {
      console.error(`[${label}] failed`, error);
    });
  }, 0);
}
