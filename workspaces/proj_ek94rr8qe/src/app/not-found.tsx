import Link from "next/link";

export default function NotFound() {
  return (
    <div className="p-10 max-w-xl mx-auto text-center">
      <h1 className="text-3xl font-semibold mb-2">404</h1>
      <p className="text-ink-500 mb-6">
        お探しのページは見つかりませんでした。
      </p>
      <Link href="/" className="btn btn-primary">
        ダッシュボードへ戻る
      </Link>
    </div>
  );
}
