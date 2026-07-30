import { getTable, getOrCreateProfile, newId, nowIso, type Row } from "@/lib/mock-db/store";

type Filter = ["eq", string, unknown] | ["in", string, unknown[]];
type Op = "select" | "insert" | "update" | "upsert";
type SingleMode = "single" | "maybeSingle" | null;

interface Result {
  data: unknown;
  error: { message: string; code?: string } | null;
  status: number;
}

// A minimal, chainable stand-in for postgrest-js's query builder — just
// enough of the surface (select/eq/in/order/limit/single/maybeSingle/
// insert/update/upsert) that the app's existing routes work unmodified.
// It's a thenable so `await supabase.from(x).select().eq(...)` (no
// .single()) resolves the same way the real client does.
export class MockQueryBuilder implements PromiseLike<Result> {
  private op: Op = "select";
  private payload: Row | Row[] | null = null;
  private onConflict: string | null = null;
  private filters: Filter[] = [];
  private orderBy: { col: string; ascending: boolean } | null = null;
  private limitN: number | null = null;
  private singleMode: SingleMode = null;

  constructor(private table: string) {}

  select(columns?: string) {
    void columns; // column projection isn't implemented — mock always returns full rows
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push(["eq", column, value]);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push(["in", column, values]);
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col: column, ascending: opts?.ascending ?? true };
    return this;
  }

  limit(n: number) {
    this.limitN = n;
    return this;
  }

  insert(payload: Row | Row[]) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Row) {
    this.op = "update";
    this.payload = payload;
    return this;
  }

  upsert(payload: Row | Row[], opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = payload;
    this.onConflict = opts?.onConflict ?? "id";
    return this;
  }

  async single(): Promise<Result> {
    this.singleMode = "single";
    return this.execute();
  }

  async maybeSingle(): Promise<Result> {
    this.singleMode = "maybeSingle";
    return this.execute();
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private matches(row: Row): boolean {
    return this.filters.every(([kind, col, val]) => {
      if (kind === "eq") return row[col] === val;
      return Array.isArray(val) && val.includes(row[col]);
    });
  }

  private finish(rows: Row[]): Result {
    if (this.singleMode === "single") {
      if (rows.length === 0) {
        return {
          data: null,
          error: { message: "No rows found", code: "PGRST116" },
          status: 406,
        };
      }
      return { data: rows[0], error: null, status: 200 };
    }
    if (this.singleMode === "maybeSingle") {
      return { data: rows[0] ?? null, error: null, status: 200 };
    }
    return { data: rows, error: null, status: 200 };
  }

  private async execute(): Promise<Result> {
    if (this.table === "profiles") {
      for (const [kind, col, val] of this.filters) {
        if (kind === "eq" && col === "id") {
          getOrCreateProfile(val as string);
        }
      }
    }

    const table = getTable(this.table);

    if (this.op === "select") {
      let rows = table.filter((row) => this.matches(row));
      if (this.orderBy) {
        const { col, ascending } = this.orderBy;
        rows = [...rows].sort((a, b) => {
          const av = a[col] as string | number;
          const bv = b[col] as string | number;
          if (av === bv) return 0;
          const cmp = av > bv ? 1 : -1;
          return ascending ? cmp : -cmp;
        });
      }
      if (this.limitN !== null) {
        rows = rows.slice(0, this.limitN);
      }
      return this.finish(rows);
    }

    if (this.op === "insert") {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      const inserted = incoming.map((row) => ({
        id: newId(),
        created_at: nowIso(),
        ...row,
      }));
      table.push(...inserted);
      return this.finish(inserted);
    }

    if (this.op === "update") {
      const matched = table.filter((row) => this.matches(row));
      matched.forEach((row) => {
        Object.assign(row, this.payload);
        if ("updated_at" in row) row.updated_at = nowIso();
      });
      return this.finish(matched);
    }

    // upsert
    const incoming = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
    const conflictCols = (this.onConflict ?? "id").split(",").map((s) => s.trim());
    const affected: Row[] = [];
    for (const row of incoming) {
      const existing = table.find((candidate) =>
        conflictCols.every((col) => candidate[col] === row[col]),
      );
      if (existing) {
        Object.assign(existing, row);
        if ("updated_at" in existing) existing.updated_at = nowIso();
        affected.push(existing);
      } else {
        const created = { id: newId(), created_at: nowIso(), ...row };
        table.push(created);
        affected.push(created);
      }
    }
    return this.finish(affected);
  }
}
