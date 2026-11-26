import { createDeliveryProducer, type DeliveryProducer, type DeliveryRef } from "@hookflow/queue";
import { config } from "./config.js";

let producer: DeliveryProducer | null = null;

/** Created on first use; the server calls this at startup so it connects early. */
export function getDeliveryProducer(): DeliveryProducer {
  producer ??= createDeliveryProducer({
    redisUrl: config.REDIS_URL,
    prefix: config.QUEUE_PREFIX,
    onError: (err) => {
      if (config.NODE_ENV !== "test") console.error("Queue connection error:", err.message);
    },
  });
  return producer;
}

export function enqueueDeliveries(deliveries: DeliveryRef[]): Promise<void> {
  return getDeliveryProducer().enqueue(deliveries);
}

export async function closeDeliveryProducer(): Promise<void> {
  await producer?.close();
  producer = null;
}
