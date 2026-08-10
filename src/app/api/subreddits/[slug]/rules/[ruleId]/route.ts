import { requireCurrentUser } from "@/lib/auth";
import { handler, readJson } from "@/lib/route-helpers";
import { deleteRule, updateRule } from "@/lib/subreddits";

type Params = { params: Promise<{ slug: string; ruleId: string }> };

/** PATCH /api/subreddits/[slug]/rules/[ruleId] — moderator only. */
export async function PATCH(request: Request, { params }: Params) {
  return handler(async () => {
    const { slug, ruleId } = await params;
    const user = await requireCurrentUser();
    const body = await readJson(request);

    return {
      rule: await updateRule(slug, user.id, ruleId, {
        title: body.title,
        description: body.description,
      }),
    };
  });
}

/** DELETE /api/subreddits/[slug]/rules/[ruleId] — moderator only. */
export async function DELETE(_request: Request, { params }: Params) {
  return handler(async () => {
    const { slug, ruleId } = await params;
    const user = await requireCurrentUser();
    await deleteRule(slug, user.id, ruleId);
    return { deleted: true };
  });
}
