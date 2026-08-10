import { NextResponse } from "next/server";
import { bedrockStatus } from "@/lib/ai";
import { getDriver } from "@/lib/db";

/**
 * Health and diagnostics.
 *
 * Reports which storage driver is active and which Bedrock models are on
 * cooldown. Without the latter, an AI feature silently serving fallback output
 * looks identical to one that is working, and the only way to tell was reading
 * server logs.
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
  });
}
