
import { usePeriods } from "../hooks/usePeriods";

export function PeriodSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: periods } = usePeriods();
  return (
    <select className="form-select" style={{ width: 140 }} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">-- Period --</option>
      {(periods || []).map((p) => (
        <option key={p.period_id} value={p.period_id}>
          {p.period_id} ({p.status})
        </option>
      ))}
    </select>
  );
}
