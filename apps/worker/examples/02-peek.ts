/**
 * Shows the jobs sitting in HookFlow's real delivery queue. Read-only.
 *
 *   pnpm --filter @hookflow/worker learn:peek
 */
import { createDeliveryProducer } from "@hookflow/queue";

const producer = createDeliveryProducer({
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6380",
  prefix: process.env.QUEUE_PREFIX,
});
await producer.ready();

console.log(await producer.queue.getJobCounts("waiting", "delayed", "active", "completed", "failed"));
for (const job of await producer.queue.getJobs(["waiting", "delayed", "active"], 0, 19)) {
  console.log(`${job.id}  ${await job.getState()}  data=${JSON.stringify(job.data)}`);
}

await producer.close();
