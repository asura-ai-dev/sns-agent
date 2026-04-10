/**
 * Task 3006: 投稿作成ページ
 *
 * PostForm がクライアント側で SNS 選択・本文入力・バリデーション・
 * プレビュー・送信を担当する。このページは見出しと戻る動線だけ担当。
 */
import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { PostForm } from "@/components/posts/PostForm";

export default function NewPostPage() {
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
          composition desk · 新規起稿
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold leading-tight tracking-tight text-base-content">
          新しい投稿を作成
        </h1>
        <p className="mt-1 text-sm text-base-content/60">
          SNS アカウントを選び、本文とメディアを入力してから下書き保存または即時投稿します。
        </p>
      </div>

      <PostForm />
    </div>
  );
}
