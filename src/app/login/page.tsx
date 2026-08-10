import { redirect } from "next/navigation";
import { Suspense } from "react";
import LoginForm from "@/components/login-form";
import { isSignedIn } from "@/lib/auth";

/**
 * Sign-in page: brand panel on the left, form on the right.
 *
 * The two columns stack on narrow screens, where the brand panel shrinks to a
 * header so the form stays above the fold — a full-height logo on a phone would
 * push the fields off-screen.
 */

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Already signed in: nothing to do here.
  if (await isSignedIn()) redirect("/");

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Brand panel */}
      <div className="flex shrink-0 items-center justify-center bg-gradient-to-br from-orange-500 to-rose-600 px-6 py-10 md:min-h-dvh md:w-1/2 md:py-0">
        <div className="flex flex-col items-center gap-4 text-center">
          <span
            aria-hidden
            className="text-[6rem] font-bold leading-none text-white md:text-[11rem]"
          >
            Ω
          </span>
          <div className="text-white">
            <p className="text-2xl font-bold tracking-tight md:text-4xl">
              Hot Takes
            </p>
            <p className="mt-1 text-sm text-white/80 md:text-base">
              Opinions, ranked by everyone else.
            </p>
          </div>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center px-6 py-10 md:py-0">
        {/* LoginForm reads ?next= via useSearchParams. */}
        <Suspense fallback={<div className="h-72 w-full max-w-sm" />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
