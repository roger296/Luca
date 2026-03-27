import { validateDualBalance } from "../../../src/engine/currency";

describe("validateDualBalance", () => {
  it("returns balanced=true for a balanced transaction", () => {
    const lines = [
      { debit: "1000.0000", credit: "0.0000", base_debit: "850.0000", base_credit: "0.0000" },
      { debit: "0.0000", credit: "833.3333", base_debit: "0.0000", base_credit: "708.3333" },
      { debit: "0.0000", credit: "166.6667", base_debit: "0.0000", base_credit: "141.6667" },
    ];
    const result = validateDualBalance(lines);
    expect(result.transactionBalanced).toBe(true);
    expect(result.baseBalanced).toBe(true);
  });

  it("returns balanced=false when debits != credits", () => {
    const lines = [
      { debit: "1000.0000", credit: "0.0000", base_debit: "1000.0000", base_credit: "0.0000" },
      { debit: "0.0000", credit: "500.0000", base_debit: "0.0000", base_credit: "500.0000" },
    ];
    const result = validateDualBalance(lines);
    expect(result.transactionBalanced).toBe(false);
  });

  it("returns balanced=true for zero-value lines", () => {
    const lines: Array<{ debit: string; credit: string; base_debit: string; base_credit: string }> = [];
    const result = validateDualBalance(lines);
    expect(result.transactionBalanced).toBe(true);
    expect(result.baseBalanced).toBe(true);
  });
});
