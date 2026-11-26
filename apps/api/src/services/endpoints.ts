import { randomUUID } from "node:crypto";
import { prisma } from "@hookflow/db";
import type { EndpointDto, EndpointWithSecretDto } from "@hookflow/shared";
import { encryptSecret } from "../lib/secretBox.js";
import { UnsafeUrlError, assertSafeUrl, type UrlPolicy } from "../lib/ssrf.js";
import { generateSigningSecret } from "../lib/tokens.js";
import { AppError } from "../middleware/errorHandler.js";

export const MAX_ENDPOINTS_PER_USER = 50;

export interface EndpointInput {
  name: string;
  url: string;
  eventTypes: string[];
  isActive?: boolean;
}

/** Never select signingSecretEncrypted into anything that reaches a response. */
const endpointSelect = {
  id: true,
  name: true,
  url: true,
  eventTypes: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

type EndpointRow = Omit<EndpointDto, "createdAt" | "updatedAt"> & {
  createdAt: Date;
  updatedAt: Date;
};

function toDto(row: EndpointRow): EndpointDto {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

/** Every lookup is scoped to the owner and ignores soft-deleted rows. */
function ownedBy(userId: string, id?: string) {
  return { userId, deletedAt: null, ...(id ? { id } : {}) };
}

function notFound(): AppError {
  return new AppError(404, "NOT_FOUND", "Endpoint not found");
}

export function createEndpointService(urlPolicy: UrlPolicy) {
  async function checkUrl(input: string): Promise<string> {
    try {
      return (await assertSafeUrl(input, urlPolicy)).url.href;
    } catch (err) {
      if (err instanceof UnsafeUrlError) {
        throw new AppError(400, "INVALID_ENDPOINT_URL", err.message, { url: [err.message] });
      }
      throw err;
    }
  }

  async function get(userId: string, id: string): Promise<EndpointDto> {
    const row = await prisma.endpoint.findFirst({
      where: ownedBy(userId, id),
      select: endpointSelect,
    });
    if (!row) throw notFound();
    return toDto(row);
  }

  return {
    get,

    async list(userId: string): Promise<EndpointDto[]> {
      const rows = await prisma.endpoint.findMany({
        where: ownedBy(userId),
        select: endpointSelect,
        orderBy: { createdAt: "desc" },
      });
      return rows.map(toDto);
    },

    async create(userId: string, input: EndpointInput): Promise<EndpointWithSecretDto> {
      if ((await prisma.endpoint.count({ where: ownedBy(userId) })) >= MAX_ENDPOINTS_PER_USER) {
        throw new AppError(
          409,
          "ENDPOINT_LIMIT_REACHED",
          `You can have at most ${MAX_ENDPOINTS_PER_USER} endpoints`
        );
      }

      const url = await checkUrl(input.url);
      // The id is needed up front: the secret's encryption is bound to it
      const id = randomUUID();
      const signingSecret = generateSigningSecret();
      const row = await prisma.endpoint.create({
        data: {
          ...input,
          id,
          url,
          userId,
          signingSecretEncrypted: encryptSecret(signingSecret, id),
        },
        select: endpointSelect,
      });
      return { ...toDto(row), signingSecret };
    },

    async update(userId: string, id: string, changes: Partial<EndpointInput>): Promise<EndpointDto> {
      // Confirm ownership before doing a DNS lookup on the caller's behalf
      await get(userId, id);
      const data = changes.url ? { ...changes, url: await checkUrl(changes.url) } : changes;

      // updateMany keeps the ownership and not-deleted conditions in the write itself
      const { count } = await prisma.endpoint.updateMany({ where: ownedBy(userId, id), data });
      if (count === 0) throw notFound();
      return get(userId, id);
    },

    /** Soft delete: delivery history is kept; the signing secret is discarded. */
    async remove(userId: string, id: string): Promise<void> {
      const { count } = await prisma.endpoint.updateMany({
        where: ownedBy(userId, id),
        data: { deletedAt: new Date(), isActive: false, signingSecretEncrypted: "" },
      });
      if (count === 0) throw notFound();
    },

    /** Replaces the secret immediately; the old one stops being used. */
    async rotateSecret(userId: string, id: string): Promise<EndpointWithSecretDto> {
      const signingSecret = generateSigningSecret();
      const { count } = await prisma.endpoint.updateMany({
        where: ownedBy(userId, id),
        data: { signingSecretEncrypted: encryptSecret(signingSecret, id) },
      });
      if (count === 0) throw notFound();
      return { ...(await get(userId, id)), signingSecret };
    },
  };
}
