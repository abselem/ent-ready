export type AnswerStatus = "saving" | "saved" | "error";
export interface AnswerState { questionId: number; optionId: number; revision: number; status: AnswerStatus }
type Entry = { desired: AnswerState; running?: Promise<void> };

/** One write per question in flight; newer choices are coalesced, never reordered. */
export class AnswerWriteQueue {
  private entries = new Map<number, Entry>();
  private accepting = true;
  private notify?: (state: AnswerState) => void;
  private send: (questionId: number, optionId: number) => Promise<unknown>;
  constructor(send: (questionId: number, optionId: number) => Promise<unknown>, notify?: (state: AnswerState) => void) { this.send = send; this.notify = notify; }

  choose(questionId: number, optionId: number) {
    if (!this.accepting) return;
    const old = this.entries.get(questionId);
    const entry: Entry = old ?? { desired: { questionId, optionId, revision: 0, status: "saving" } };
    entry.desired = { questionId, optionId, revision: entry.desired.revision + 1, status: "saving" };
    this.entries.set(questionId, entry);
    this.publish(entry);
    this.start(entry);
  }
  retry(questionId: number) {
    const entry = this.entries.get(questionId);
    if (!this.accepting || !entry || entry.running || entry.desired.status !== "error") return;
    entry.desired = { ...entry.desired, status: "saving" };
    this.publish(entry);
    this.start(entry);
  }
  state(questionId: number): AnswerState | undefined {
    const value = this.entries.get(questionId)?.desired;
    return value ? { ...value } : undefined;
  }
  private publish(entry: Entry) { this.notify?.({ ...entry.desired }); }
  private start(entry: Entry) {
    if (entry.running || !this.accepting) return;
    // Defer work one microtask so `running` is installed before even a sync throw.
    entry.running = Promise.resolve().then(async () => {
      while (this.accepting) {
        const request = { ...entry.desired };
        try {
          await this.send(request.questionId, request.optionId);
          if (entry.desired.revision === request.revision) {
            entry.desired = { ...entry.desired, status: "saved" };
            this.publish(entry);
            break;
          }
        } catch {
          if (entry.desired.revision === request.revision) {
            entry.desired = { ...entry.desired, status: "error" };
            this.publish(entry);
            break;
          }
          // A superseded failed choice must not discard the latest choice.
        }
      }
    }).finally(() => { entry.running = undefined; });
  }
  async flush(): Promise<boolean> {
    while (true) {
      const pending = [...this.entries.values()].flatMap((entry) => entry.running ? [entry.running] : []);
      if (!pending.length) break;
      await Promise.all(pending);
    }
    return [...this.entries.values()].every((entry) => entry.desired.status === "saved");
  }
  /** Expiry stops queued writes; the server decides which already-sent writes count. */
  freeze() { this.accepting = false; }
  async settleWithin(milliseconds: number): Promise<boolean> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      this.flush(),
      new Promise<boolean>((resolve) => { timeout = setTimeout(() => resolve(false), milliseconds); }),
    ]);
    if (timeout) clearTimeout(timeout);
    return result;
  }
  dispose() { this.freeze(); this.notify = undefined; }
}

export function remainingSeconds(endAt: number | null, now = Date.now()): number | null {
  return endAt === null ? null : Math.max(0, Math.ceil((endAt - now) / 1000));
}
export function scorePercent(score: number | null, maxScore: number | null): number | null {
  if (score === null || maxScore === null || !Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) return null;
  return Math.round((score / maxScore) * 100);
}
