/**
 * The contract between the API (producer) and the worker (consumer).
 * Both sides import it, so they cannot disagree about names or job contents.
 * A mismatch would raise no error; jobs would just never be picked up.
 */
import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const DELIVERY_QUEUE = "deliveries";
/** Namespaces our keys in Redis. Tests use a different one. */
export const DEFAULT_QUEUE_PREFIX = "hookflow";

/** Only an ID: the worker reads current data from PostgreSQL, the source of truth. */
export interface DeliveryJob {
  deliveryId: string;
}

export interface DeliveryRef {
  deliveryId: string;
  /** 1 for the first attempt. */
  attemptNumber: number;
}

/**
 * One job is one attempt. Adding the same attempt twice yields one job, while
 * the next attempt gets a new ID. ("-" because BullMQ restricts ":".)
 */
export function deliveryJobId({ deliveryId, attemptNumber }: DeliveryRef): string {
  return `${deliveryId}-${attemptNumber}`;
}

export interface DeliveryProducer {
  /** Exposed for inspection (tests, debugging). Add jobs through `enqueue`. */
  queue: Queue<DeliveryJob>;
  /** Resolves once Redis is connected. */
  ready(): Promise<void>;
  /**
   * Adds one job per delivery. Rejects straight away while Redis is not
   * connected. Callers should still bound the wait with a timeout.
   */
  enqueue(deliveries: DeliveryRef[]): Promise<void>;
  close(): Promise<void>;
}

export interface ProducerOptions {
  redisUrl: string;
  prefix?: string;
  onError?: (error: Error) => void;
}

export function createDeliveryProducer({
  redisUrl,
  prefix = DEFAULT_QUEUE_PREFIX,
  onError = () => {},
}: ProducerOptions): DeliveryProducer {
  const connection = new Redis(redisUrl, {
    // A producer should give up on a command quickly (workers use `null`)
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
  // Without listeners, connection errors would crash the process
  connection.on("error", onError);

  const queue = new Queue<DeliveryJob>(DELIVERY_QUEUE, { connection, prefix });
  queue.on("error", onError);

  return {
    queue,

    async ready() {
      await queue.waitUntilReady();
    },

    async enqueue(deliveries) {
      // BullMQ would otherwise wait for a connection indefinitely
      if (connection.status !== "ready") throw new Error("Redis is not connected");

      await queue.addBulk(
        deliveries.map((ref) => ({
          name: "attempt",
          data: { deliveryId: ref.deliveryId },
          opts: {
            jobId: deliveryJobId(ref),
            // Retries are scheduled from the database, not by BullMQ
            attempts: 1,
            // A kept job would block re-adding its ID during recovery
            removeOnComplete: true,
            removeOnFail: true,
          },
        }))
      );
    },

    async close() {
      if (connection.status === "ready") {
        await queue.close();
        await connection.quit();
      } else {
        // Nothing to flush, and a polite close would wait for Redis to return
        connection.disconnect();
      }
    },
  };
}
