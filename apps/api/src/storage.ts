import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { config } from "./config.js";

/**
 * Neon object storage client (S3-compatible).
 *
 * Neon buckets are addressed by path (`<endpoint>/<bucket>/<key>`), not by
 * virtual-host subdomain, so forcePathStyle is required.
 */
let s3Client: S3Client | null = null;

export function getStorageClient(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: config.AWS_REGION,
      endpoint: config.AWS_ENDPOINT_URL_S3,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.AWS_ACCESS_KEY_ID,
        secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
      },
    });
  }

  return s3Client;
}

export async function checkBucket(bucket = config.STORAGE_BUCKET): Promise<void> {
  await getStorageClient().send(new HeadBucketCommand({ Bucket: bucket }));
}

export async function putObject(
  key: string,
  body: string | Uint8Array,
  contentType = "application/octet-stream",
  bucket = config.STORAGE_BUCKET
): Promise<void> {
  await getStorageClient().send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType })
  );
}

export async function getObjectText(
  key: string,
  bucket = config.STORAGE_BUCKET
): Promise<string> {
  const res = await getStorageClient().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!res.Body) throw new Error(`Object ${bucket}/${key} has no body`);
  return res.Body.transformToString();
}

export async function deleteObject(key: string, bucket = config.STORAGE_BUCKET): Promise<void> {
  await getStorageClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export function closeStorageClient(): void {
  if (s3Client) {
    s3Client.destroy();
    s3Client = null;
  }
}
