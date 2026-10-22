export type PendingAttachmentSource = "entry" | "reply";
export type PendingAttachmentFailures = Record<PendingAttachmentSource, string[]>;

/** 投稿前に永続保存したファイルだけを追跡する。投稿済みIDはreleaseで除外する。 */
export class ReviewTimelinePendingAttachments {
  private pending = new Map<string, PendingAttachmentSource>();
  private deleting = new Map<string, Promise<boolean>>();
  private closed = false;

  constructor(
    private readonly remove: (id: string) => Promise<void>,
    private readonly onLateCleanup: (failures: PendingAttachmentFailures) => void,
  ) {}

  track(id: string, source: PendingAttachmentSource) {
    this.pending.set(id, source);
    if (this.closed) {
      void this.clear([id]).then(this.onLateCleanup);
      return false;
    }
    return true;
  }

  release(ids: string[]) {
    ids.forEach((id) => this.pending.delete(id));
  }

  private removeOne(id: string) {
    const inProgress = this.deleting.get(id);
    if (inProgress) return inProgress;
    const deletion = this.remove(id).then(() => {
      this.pending.delete(id);
      return true;
    }, () => false).finally(() => { this.deleting.delete(id); });
    this.deleting.set(id, deletion);
    return deletion;
  }

  async clear(ids: string[]): Promise<PendingAttachmentFailures> {
    const targets = [...new Set(ids)].filter((id) => this.pending.has(id));
    const sources = targets.map((id) => this.pending.get(id)!);
    const results = await Promise.all(targets.map((id) => this.removeOne(id)));
    const failures: PendingAttachmentFailures = { entry: [], reply: [] };
    results.forEach((removed, index) => { if (!removed) failures[sources[index]].push(targets[index]); });
    return failures;
  }

  dispose() {
    this.closed = true;
    return this.clear([...this.pending.keys()]);
  }
}
