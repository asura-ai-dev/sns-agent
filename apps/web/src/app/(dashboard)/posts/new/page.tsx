/**
 * Task 3006: 投稿作成ページ
 *
 * PostForm がクライアント側で SNS 選択・本文入力・バリデーション・
 * プレビュー・送信を担当する。このページは見出しと戻る動線だけ担当。
 */
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { PostForm } from "@/components/posts/PostForm";
import { MASTHEAD_TITLES, SECTION_KICKERS } from "@/lib/i18n/labels";

export default function NewPostPage() {
  const xPremium = process.env.X_PREMIUM === "true";

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/posts"
          className="inline-flex items-center gap-1.5 text-[0.65rem] font-medium uppercase tracking-[0.14em] text-base-content/50 hover:text-base-content"
        >
          <ArrowLeft size={12} weight="bold" />
          投稿一覧へ戻る
        </Link>
        <p className="mt-3 font-mono text-[0.65rem] font-medium uppercase tracking-[0.22em] text-base-content/50">
          {SECTION_KICKERS.compose}
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold leading-tight tracking-tight text-base-content">
          {MASTHEAD_TITLES.postsNew}
        </h1>
      </div>

      <Suspense
        fallback={
          <div className="rounded-box border border-base-300 bg-base-100 p-5 text-sm text-base-content/60">
            投稿フォームを読み込んでいます…
          </div>
        }
      >
        <PostForm xPremium={xPremium} />
      </Suspense>
    </div>
  );
}
