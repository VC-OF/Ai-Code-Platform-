export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="p-10 max-w-xl mx-auto text-center">
      <h1 className="text-2xl font-semibold mb-2">エラーが発生しました</h1>
      <p className="text-ink-500 mb-6">
        予期しない問題が発生しました。もう一度お試しください。
      </p>
      <button className="btn btn-primary" onClick={() => reset()}>
        再試行
      </button>
    </div>
  );
}
