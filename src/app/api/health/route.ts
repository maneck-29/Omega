import { NextResponse } from "next/server";
import { bedrockStatus } from "@/lib/bedrock";
import { getDriver } from "@/lib/db";
import { isMediaConfigured } from "@/lib/media";

/**
 * Health and diagnostics.
 *
 * Reports which storage driver is active, which Bedrock models are on cooldown,
 * and whether the S3 integration is wired. Without this, an AI feature silently
 * serving fallback output looks identical to one that is working, and the only
 * way to tell was reading server logs.
 *
 * Bucket name and region are reported because they are configuration, not
 * secrets; the credentials that can use them are never exposed.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "hot-takes",
    version: "pr-preview-test",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    storage: getDriver(),
    bedrock: bedrockStatus(),
    media: {
      configured: isMediaConfigured(),
      bucket: process.env.BUCKET_NAME ?? null,
      region: process.env.BUCKET_REGION ?? null,
    },
  });
}
