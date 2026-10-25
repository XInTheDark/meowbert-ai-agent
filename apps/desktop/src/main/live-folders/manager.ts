import type { LocalLiveFolderConfig } from "@meowbert/shared";
import { startNativeLiveFolder, type LiveFolderMount } from "./native-mount";

interface Entry { mount: LiveFolderMount; connectionId: string; consumers: Set<string> }
export class LiveFolderManager {
  private readonly entries = new Map<string, Entry>();
  private readonly locks = new Map<string, Promise<unknown>>();
  constructor(private readonly root: string, private readonly binary: string,
    private readonly start: typeof startNativeLiveFolder = startNativeLiveFolder) {}

  private async locked<T>(id: string, run: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const work = previous.then(run, run);
    this.locks.set(id, work);
    try { return await work; }
    finally { if (this.locks.get(id) === work) this.locks.delete(id); }
  }

  acquire(folder: LocalLiveFolderConfig, consumer: string, signal: AbortSignal): Promise<string> {
    return this.locked(folder.linkId, async () => {
      signal.throwIfAborted();
      let entry = this.entries.get(folder.linkId);
      if (entry && entry.connectionId !== folder.connectionId) throw new Error("The live Drive connection changed while the folder is in use.");
      const consumers = new Set(entry?.consumers ?? []);
      if (entry?.mount.isReady && !await entry.mount.isReady()) {
        await entry.mount.stop(); this.entries.delete(folder.linkId); entry = undefined;
      }
      if (!entry) {
        const mount = await this.start({ root: this.root, binary: this.binary, folder, signal });
        if (signal.aborted) { await mount.stop(); signal.throwIfAborted(); }
        entry = { mount, connectionId: folder.connectionId, consumers };
        this.entries.set(folder.linkId, entry);
      }
      entry.consumers.add(consumer);
      return entry.mount.path;
    });
  }

  async release(consumer: string): Promise<void> {
    await Promise.all([...new Set([...this.entries.keys(), ...this.locks.keys()])].map((id) => this.locked(id, async () => {
      const entry = this.entries.get(id);
      if (!entry) return;
      entry.consumers.delete(consumer);
      if (entry.consumers.size > 0) return;
      await entry.mount.stop();
      this.entries.delete(id);
    })));
  }
}
