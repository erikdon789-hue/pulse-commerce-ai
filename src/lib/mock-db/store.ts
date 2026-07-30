// In-memory substitute for Supabase's Data API (PostgREST), used only while
// MOCK_DATA_API=true (see lib/supabase/server.ts and service.ts). Auth and
// Storage keep hitting the real Supabase services — only table reads/writes
// are mocked here, since PostgREST is the specific service that's down.
//
// Stored on globalThis so state survives Turbopack/webpack HMR reloads in
// dev (a plain module-level variable would reset on every file edit).

export type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

const globalForMockDb = globalThis as unknown as { __mockDb?: Tables };

if (!globalForMockDb.__mockDb) {
  globalForMockDb.__mockDb = {};
}

export const mockDb = globalForMockDb.__mockDb;

export function getTable(name: string): Row[] {
  if (!mockDb[name]) {
    mockDb[name] = [];
  }
  return mockDb[name];
}

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

// Mirrors the 0003_auth_trigger.sql behavior (auto-create a profile with
// free credits on first sighting of a user) since that Postgres trigger
// doesn't run against the mock store.
export function getOrCreateProfile(id: string, email?: string): Row {
  const profiles = getTable("profiles");
  const existing = profiles.find((row) => row.id === id);
  if (existing) return existing;

  const created: Row = {
    id,
    email: email ?? "mock@local.test",
    full_name: null,
    stripe_customer_id: null,
    credits_balance: 3,
    created_at: nowIso(),
  };
  profiles.push(created);
  return created;
}
