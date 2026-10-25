/** A device resource has one task owner until release or inactivity after its last action. */
export class DeviceTaskLock {
  private owner: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = 0;
  constructor(private readonly resource: string, private readonly idleMs: number, private readonly onRelease?: () => void) {}

  acquire(taskId: string): void {
    if (!taskId) throw new Error("A task is required to use " + this.resource + ".");
    if (this.owner && this.owner !== taskId) throw new Error(this.resource + " is in use by " + this.owner + ".");
    this.owner = taskId;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async use<T>(taskId: string, action: () => Promise<T>): Promise<T> {
    this.acquire(taskId);
    this.active += 1;
    try { return await action(); }
    finally {
      this.active -= 1;
      if (this.owner === taskId && this.active === 0) {
        this.timer = setTimeout(() => this.release(taskId), this.idleMs);
        this.timer.unref();
      }
    }
  }

  release(taskId: string): void {
    if (this.owner !== taskId) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.owner = null;
    this.onRelease?.();
  }
}
