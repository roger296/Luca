
import { fmtMoney } from "../lib/api";

export function MoneyCell({ value, currency }: { value?: string | null; currency?: string }) {
  const n = parseFloat(value || "0");
  const cls = "mono" + (n < 0 ? " neg" : "");
  return <span className={cls}>{fmtMoney(value, currency)}</span>;
}

export function DebitCreditCells({ debit, credit, currency }: { debit?: string; credit?: string; currency?: string }) {
  const d = parseFloat(debit || "0");
  const c = parseFloat(credit || "0");
  return (
    <>
      <td className="num">{d > 0 ? <span className="mono">{fmtMoney(debit, currency)}</span> : ""}</td>
      <td className="num">{c > 0 ? <span className="mono">{fmtMoney(credit, currency)}</span> : ""}</td>
    </>
  );
}
