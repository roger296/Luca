const fs = require('fs');
const path = 'src/db/queries/reports.ts';
let src = fs.readFileSync(path, 'utf8');

// 1. Update return type signature to include category and running_net
src = src.replace(
  `): Promise<{
  data: Array<{
    transaction_id: string;
    date: string;
    description: string | null;
    reference: string | null;
    debit: string;
    credit: string;
    transaction_type: string;
  }>;
  total: number;
}> {`,
  `): Promise<{
  data: Array<{
    transaction_id: string;
    date: string;
    description: string | null;
    reference: string | null;
    debit: string;
    credit: string;
    transaction_type: string;
    category: string;
    running_net: string;
  }>;
  total: number;
}> {`
);

// 2. Replace the data rows query to add accounts join, category, and window function
src = src.replace(
  `  const rows = await buildBase()
    .select(
      "t.transaction_id",
      "t.date",
      "tl.description",
      "t.reference",
      knex.raw("tl.debit::text AS debit"),
      knex.raw("tl.credit::text AS credit"),
      "t.transaction_type"
    )
    .orderBy([
      { column: "t.date", order: "asc" },
      { column: "t.transaction_id", order: "asc" },
      { column: "tl.line_number", order: "asc" },
    ])
    .limit(pageSize)
    .offset(offset);`,
  `  const rows = await buildBase()
    .join("accounts as a", function () {
      this.on("a.code", "=", "tl.account_code").andOn(
        "a.tenant_id",
        "=",
        "tl.tenant_id"
      );
    })
    .select(
      "t.transaction_id",
      "t.date",
      "tl.description",
      "t.reference",
      knex.raw("tl.debit::text AS debit"),
      knex.raw("tl.credit::text AS credit"),
      "t.transaction_type",
      "a.category",
      knex.raw(
        "SUM(tl.debit - tl.credit) OVER (" +
        "ORDER BY t.date ASC, t.transaction_id ASC, tl.line_number ASC " +
        "ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW" +
        ")::text AS running_net"
      )
    )
    .orderBy([
      { column: "t.date", order: "asc" },
      { column: "t.transaction_id", order: "asc" },
      { column: "tl.line_number", order: "asc" },
    ])
    .limit(pageSize)
    .offset(offset);`
);

// 3. Update the final return type cast
src = src.replace(
  `    data: rows as Array<{
      transaction_id: string;
      date: string;
      description: string | null;
      reference: string | null;
      debit: string;
      credit: string;
      transaction_type: string;
    }>,`,
  `    data: rows as Array<{
      transaction_id: string;
      date: string;
      description: string | null;
      reference: string | null;
      debit: string;
      credit: string;
      transaction_type: string;
      category: string;
      running_net: string;
    }>,`
);

fs.writeFileSync(path, src, { encoding: 'utf8' });
console.log('running_net present:', src.includes('running_net'));
console.log('a.category present:', src.includes('"a.category"'));
console.log('window function present:', src.includes('UNBOUNDED PRECEDING'));
console.log('accounts join present:', src.includes('"accounts as a"'));
