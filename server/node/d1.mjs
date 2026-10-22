// База Cloudflare D1 поверх обычного файла SQLite (node:sqlite) — для запуска worker.js на своём сервере.
// Поддерживается то, чем пользуется worker.js: prepare().bind().first()/run()/all() и batch() (атомарно).

function norm(v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === undefined) throw new TypeError('D1_TYPE_ERROR: undefined в параметрах запроса');
  return v;
}

export function makeD1(db) {
  const cache = new Map();
  const prep = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = db.prepare(sql); cache.set(sql, s); }
    return s;
  };
  const exec = (st) => {
    const s = prep(st.sql);
    if (s.columns().length) return { results: s.all(...st.params), success: true, meta: {} };
    const r = s.run(...st.params);
    return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  };

  class Stmt {
    constructor(sql, params = []) { this.sql = sql; this.params = params; }
    bind(...p) { return new Stmt(this.sql, p.map(norm)); }
    async first(col) {
      const r = prep(this.sql).get(...this.params);
      if (r == null) return null;
      return col ? (r[col] ?? null) : { ...r };
    }
    async run() { return exec(this); }
    async all() {
      const r = exec(this);
      r.results = r.results.map(x => ({ ...x }));
      return r;
    }
  }

  return {
    prepare: (sql) => new Stmt(sql),
    // как в D1: все запросы пачки — одна транзакция (или всё, или ничего)
    async batch(stmts) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const out = stmts.map(st => {
          const r = exec(st);
          r.results = r.results.map(x => ({ ...x }));
          return r;
        });
        db.exec('COMMIT');
        return out;
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch (e2) {}
        throw e;
      }
    },
    async exec(sql) { db.exec(sql); return { count: 0, duration: 0 }; }
  };
}
