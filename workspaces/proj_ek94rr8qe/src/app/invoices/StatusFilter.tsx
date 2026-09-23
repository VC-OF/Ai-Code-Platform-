"use client";
export default function StatusFilter({ current }: { current: string }) {
  return (
    <select
      name="status"
      defaultValue={current}
      className="select"
      style={{ maxWidth: 160 }}
    >
      <option value="all">すべて</option>
      <option value="draft">下書き</option>
      <option value="issued">発行済</option>
      <option value="paid">支払済</option>
      <option value="void">無効</option>
    </select>
  );
}
