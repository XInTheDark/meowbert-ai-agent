import type { Notification, PoolClient } from "pg";
import { pool } from "../../lib/db.js";
export type DeviceEventKind = "runs" | "config" | "cleanup" | "revoked";
interface Subscription { deviceId: string; event: (kind: DeviceEventKind) => void; close: () => void }

// One LISTEN connection per API process, shared by all connected devices.
export class DeviceEvents {
  private subscriptions = new Set<Subscription>();
  private client: PoolClient | null = null;
  private connecting: Promise<void> | null = null;
  async subscribe(subscription: Subscription): Promise<() => void> {
    this.subscriptions.add(subscription);
    try { this.connecting ??= this.connect(); await this.connecting; }
    catch (error) { this.subscriptions.delete(subscription); throw error; }
    return () => {
      this.subscriptions.delete(subscription);
      if (!this.subscriptions.size) this.disconnect();
    };
  }
  private async connect(): Promise<void> {
    try {
      const client = await pool.connect(); this.client = client;
      client.on("notification", this.onNotification);
      client.on("error", this.onFailure); client.on("end", this.onFailure);
      await client.query("LISTEN device_execution_changed");
    } catch (error) { this.onFailure(); throw error; }
  }
  private onNotification = (notification: Notification) => {
    if (notification.channel !== "device_execution_changed") return;
    try {
      const value = JSON.parse(notification.payload ?? "null");
      if (!value || !["runs", "config", "cleanup", "revoked"].includes(value.kind)) return;
      if (value.deviceId !== null && typeof value.deviceId !== "string") return;
      for (const subscription of this.subscriptions) {
        if (value.deviceId === null || value.deviceId === subscription.deviceId) subscription.event(value.kind);
      }
    } catch { this.onFailure(); }
  };
  private onFailure = () => {
    const subscriptions = [...this.subscriptions]; this.subscriptions.clear(); this.disconnect();
    for (const subscription of subscriptions) subscription.close();
  };
  private disconnect(): void {
    const client = this.client; this.client = null; this.connecting = null;
    if (!client) return;
    client.off("notification", this.onNotification);
    client.off("error", this.onFailure); client.off("end", this.onFailure); client.release(true);
  }
}
export const deviceEvents = new DeviceEvents();
