type Write = { optionIds: number[]; revision: number; saved: boolean; running?: Promise<void> };

/** Serialize writes per question and retain the latest single/multiple selection. */
export class ENTAnswerQueue {
  private entries = new Map<number, Write>();
  private active = true;
  private send: (questionId: number, optionIds: number[]) => Promise<unknown>;
  private notify: (questionId: number, status: "saving" | "saved" | "error") => void;
  constructor(
    send: (questionId: number, optionIds: number[]) => Promise<unknown>,
    notify: (questionId: number, status: "saving" | "saved" | "error") => void,
  ) { this.send = send; this.notify = notify; }
  choose(questionId: number, optionIds: number[]) {
    if (!this.active) return;
    const entry = this.entries.get(questionId) ?? { optionIds: [], revision: 0, saved: false };
    entry.optionIds = [...optionIds]; entry.revision++; entry.saved = false;
    this.entries.set(questionId, entry);
    this.notify(questionId, "saving");
    if (entry.running) return;
    entry.running = Promise.resolve().then(async () => {
      while (this.active) {
        const revision = entry.revision;
        try {
          await this.send(questionId, [...entry.optionIds]);
          if (revision === entry.revision) {
            entry.saved = true;
            if (this.active) this.notify(questionId, "saved");
            break;
          }
        } catch {
          if (revision === entry.revision) {
            if (this.active) this.notify(questionId, "error");
            break;
          }
        }
      }
    }).finally(() => { entry.running = undefined; });
  }
  async flush() {
    while (true) {
      const writes = [...this.entries.values()].flatMap(entry => entry.running ? [entry.running] : []);
      if (!writes.length) break;
      await Promise.all(writes);
    }
    return [...this.entries.values()].every(entry => entry.saved);
  }
  dispose() { this.active = false; }
}
