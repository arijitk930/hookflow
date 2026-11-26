import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createDeliveryProducer } from "@hookflow/queue";

/** After the whole run, delete the jobs the tests added. */
export default function setup() {
  return async function teardown() {
    const here = path.dirname(fileURLToPath(import.meta.url));
    dotenv.config({ path: path.resolve(here, "../../../../.env") });
    const producer = createDeliveryProducer({
      redisUrl: process.env.REDIS_URL ?? "redis://localhost:6380",
      prefix: "hookflow-test",
    });
    await producer.ready();
    await producer.queue.obliterate({ force: true });
    await producer.close();
  };
}
