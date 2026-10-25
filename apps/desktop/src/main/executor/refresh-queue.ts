// Serialize and coalesce checks; a manual check upgrades any queued automatic check.
export class RefreshQueue {
  private pending = false;
  private force = false;
  private work: Promise<void> | null = null;
  constructor(private readonly refresh: (force: boolean) => Promise<void>) {}
  request(force = false): Promise<void> {
    this.pending = true; this.force ||= force;
    this.work ??= Promise.resolve().then(() => this.drain());
    return this.work;
  }
  private async drain(): Promise<void> {
    try {
      while (this.pending) {
        const force = this.force; this.pending = false; this.force = false;
        await this.refresh(force);
      }
    } finally { this.work = null; }
  }
}
