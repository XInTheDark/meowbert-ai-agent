import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { EMAIL_DELIVERY_QUEUE_NAME, TASK_QUEUE_NAME, type EmailDeliveryJob, type TaskExecutionJob } from "@meowbert/shared";
import { config } from "./config.js";

const redis = new Redis(config.redis.url, {
  maxRetriesPerRequest: null
});

export const taskQueue = new Queue<TaskExecutionJob, void, string>(TASK_QUEUE_NAME, {
  connection: redis
});

export const emailQueue = new Queue<EmailDeliveryJob, void, string>(EMAIL_DELIVERY_QUEUE_NAME, {
  connection: redis
});

export async function closeQueue(): Promise<void> {
  await Promise.all([
    taskQueue.close(),
    emailQueue.close()
  ]);
}
