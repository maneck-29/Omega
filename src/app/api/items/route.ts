import { NextResponse } from "next/server";
import { createItem, listItems } from "@/lib/items";

export async function GET() {
  return NextResponse.json({ items: listItems() });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = (body as { name?: unknown })?.name;
  if (typeof name !== "string" || name.trim() === "") {
    return NextResponse.json(
      { error: "Field 'name' is required and must be a non-empty string" },
      { status: 400 },
    );
  }

  const item = createItem(name.trim());
  return NextResponse.json({ item }, { status: 201 });
}
