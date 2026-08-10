import { requireCurrentUser } from "@/lib/auth";
import { badRequest } from "@/lib/errors";
import { handler, readJson } from "@/lib/route-helpers";
import { reorderRules } from "@/lib/subreddits";

type Params = { params: Promise<{ slug: string }> };

/**
 * PUT /api/subreddits/[slug]/rules/reorder — moderator only.
 *
 * Body: { ruleIds: string[] } — the complete ordering. A partial list is
 * rejected rather than silently leaving positions inconsistent.
 */
export async function PUT(request: Request, { params }: Params) {
  return handler(async () => {
    const { slug } = await params;
    const user = await requireCurrentUser();
    const body = await readJson(request);

    if (
      !Array.isArray(body.ruleIds) ||
      !body.ruleIds.every((id): id is string => typeof id === "string")
    ) {
      throw badRequest(
        "Field 'ruleIds' must be an array of rule ids",
        "invalid_rule_ids",
      );
    }

    return { rules: await reorderRules(slug, user.id, body.ruleIds) };
  });
}
