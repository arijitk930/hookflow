/**
 * BullMQ basics — a playground, not application code.
 *
 *   docker compose up -d redis
 *   pnpm --filter @hookflow/worker learn:basics
 *
 * It uses its own queue ("learn-basics"), wiped at the start and end of each run.
 * Change the numbers and run it again.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";

const QUEUE = "learn-basics";
const url = process.env.REDIS_URL ?? "redis://localhost:6380";

// BullMQ workers wait on Redis with blocking commands, which must never time
// out on the client side. That is what `maxRetriesPerRequest: null` allows.
const connection = new Redis(url, { maxRetriesPerRequest: null });

const startedAt = Date.now();
const log = (message: string) =>
  console.log(`${String(Date.now() - startedAt).padStart(5)} ms  ${message}`);
const title = (text: string) => console.log(`\n=== ${text} ===`);

// The PRODUCER side. In HookFlow this will be the API.
const queue = new Queue(QUEUE, { connection });
await queue.obliterate({ force: true });

const counts = async () =>
  JSON.stringify(await queue.getJobCounts("waiting", "delayed", "active", "completed", "failed"));

title("1. A job waits in Redis even when no worker is running");
const first = await queue.add("greet", { name: "Ada" });
log(`added job id=${first.id}`);
log(await counts());

title("2. A worker picks it up");
// The CONSUMER side. In HookFlow this will be apps/worker, a separate process.
const worker = new Worker(
  QUEUE,
  async (job: Job) => {
    // job.attemptsMade counts the attempts finished before this one
    log(`  start  id=${job.id} name=${job.name} attempt=${job.attemptsMade + 1}`);

    if (job.name === "flaky" && job.attemptsMade < job.data.failTimes) {
      throw new Error("receiver returned 503"); // throwing = this attempt failed
    }
    if (job.name === "slow") await sleep(1000);

    return `done: ${job.name}`; // returning = success
  },
  { connection, concurrency: 1 }
);

worker.on("completed", (job, result) => log(`  ok     id=${job.id} -> ${result}`));
worker.on("failed", (job, err) =>
  log(`  failed id=${job?.id} (${job?.attemptsMade}/${job?.opts.attempts ?? 1}): ${err.message}`)
);
worker.on("error", (err) => console.error(err));

/** Resolves once nothing is waiting, delayed or being processed. */
async function drained() {
  for (;;) {
    const c = await queue.getJobCounts("waiting", "delayed", "active");
    if (c.waiting + c.delayed + c.active === 0) return;
    await sleep(50);
  }
}

await drained();
log(await counts());

title("3. Retries: fails twice, then succeeds (backoff 500 ms, then 1000 ms)");
await queue.add(
  "flaky",
  { failTimes: 2 },
  { attempts: 4, backoff: { type: "exponential", delay: 500 } }
);
await drained();

title("4. Retries run out: the job ends up in 'failed'");
await queue.add("flaky", { failTimes: 99 }, { attempts: 2, backoff: { type: "fixed", delay: 300 } });
await drained();
log(await counts());

title("5. A delayed job");
await queue.add("greet", { name: "later" }, { delay: 1000 });
log(`right after adding: ${await counts()}`);
await drained();

title("6. The same jobId is only added once... while the job still exists");
await worker.pause();
await queue.add("greet", {}, { jobId: "delivery-abc" });
await queue.add("greet", {}, { jobId: "delivery-abc" });
log(`added twice, waiting = ${await queue.getWaitingCount()}`);
worker.resume();
await drained();
await queue.add("greet", {}, { jobId: "delivery-abc" });
await sleep(300);
log("added a third time after it completed: ignored, no new 'start' line");
await queue.remove("delivery-abc");
await queue.add("greet", {}, { jobId: "delivery-abc" });
log("removed it, then added again: now it runs");
await drained();

title("7. Concurrency: three 1-second jobs");
for (const concurrency of [1, 3]) {
  worker.concurrency = concurrency;
  const began = Date.now();
  await queue.addBulk([1, 2, 3].map(() => ({ name: "slow", data: {} })));
  await drained();
  log(`concurrency ${concurrency}: took about ${Math.round((Date.now() - began) / 1000)} s`);
}

// Graceful shutdown: close() lets running jobs finish first
await worker.close();
await queue.obliterate({ force: true });
await queue.close();
await connection.quit();
