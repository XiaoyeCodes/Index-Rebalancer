const day = 24 * 60 * 60 * 1000;
const cooldowns = [10 * 60 * 1000, 30 * 60 * 1000, day];
const empty = {failures:0, stage:0, until:0};

export function loginStore(storage) {
  const sql = storage.sql;
  sql.exec(`CREATE TABLE IF NOT EXISTS login_limit (
    subject TEXT PRIMARY KEY, failures INTEGER, stage INTEGER, until INTEGER, updated INTEGER);
    CREATE TABLE IF NOT EXISTS login_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, kind TEXT, outcome TEXT, device TEXT,
    ip TEXT, agent TEXT, deviceFailures INTEGER, ipFailures INTEGER, until INTEGER);
    CREATE INDEX IF NOT EXISTS login_event_kind_outcome_id ON login_event(kind,outcome,id);
    CREATE INDEX IF NOT EXISTS login_event_kind_id ON login_event(kind,id);
    CREATE INDEX IF NOT EXISTS login_event_at ON login_event(at);
    CREATE TABLE IF NOT EXISTS login_session (token TEXT PRIMARY KEY, salt TEXT, expires INTEGER);
    CREATE INDEX IF NOT EXISTS login_session_expires ON login_session(expires);
    CREATE TABLE IF NOT EXISTS login_receipt (id TEXT PRIMARY KEY, nonce TEXT, until INTEGER, expires INTEGER);
    CREATE INDEX IF NOT EXISTS login_receipt_expires ON login_receipt(expires);`);

  function saveReceipt(id, nonce, until, now) {
    if (!id) return;
    sql.exec('DELETE FROM login_receipt WHERE expires<=?',now);
    const expires=Math.min(until||Infinity,now+5*60*1000);
    sql.exec('INSERT INTO login_receipt(id,nonce,until,expires) VALUES(?,?,?,?)',id,nonce,until,expires);
  }

  function limits(client, now) {
    return ['device:'+client.device, client.ip && 'ip:'+client.ip].map(subject => {
      if (!subject) return empty;
      const previous = sql.exec('SELECT failures,stage,until FROM login_limit WHERE subject=? AND updated>?',subject,now-7*day).toArray()[0];
      return {subject,...(previous || empty)};
    });
  }

  function event(client, kind, outcome, now, records = [empty,empty], until = 0) {
    sql.exec('INSERT INTO login_event(at,kind,outcome,device,ip,agent,deviceFailures,ipFailures,until) VALUES(?,?,?,?,?,?,?,?,?)',
      now,kind,outcome,client.device,client.ip,client.agent,records[0].failures,records[1].failures,until);
    sql.exec('DELETE FROM login_event WHERE at<=?',now-30*day);
    sql.exec(`DELETE FROM login_event WHERE kind=? AND outcome=? AND id <= (
      SELECT id FROM login_event WHERE kind=? AND outcome=? ORDER BY id DESC LIMIT 1 OFFSET 2000)`,kind,outcome,kind,outcome);
  }

  return {
    visit(client, now) { event(client,'visit','opened',now); },
    receipt(id, now) {
      return sql.exec('SELECT nonce,until FROM login_receipt WHERE id=? AND expires>?',id,now).toArray()[0];
    },
    check(client, kind, now, receiptId) {
      const records = limits(client,now), until = Math.max(...records.map(record=>record.until));
      if (until>now) storage.transactionSync(()=>{
        event(client,kind,'blocked',now,records,until);
        saveReceipt(receiptId,null,until,now);
      });
      return until>now ? until : 0;
    },
    fail(client, kind, now, receiptId) {
      return storage.transactionSync(()=>{
        const records = limits(client,now).map(record=>{
          if (!record.subject) return record;
          const failures = record.until ? 1 : record.failures+1;
          const stage = failures===4 ? Math.min(record.stage+1,cooldowns.length) : record.stage;
          const until = failures===4 ? now+cooldowns[stage-1] : 0;
          sql.exec(`INSERT OR REPLACE INTO login_limit(subject,failures,stage,until,updated) VALUES(?,?,?,?,?)`,
            record.subject,failures,stage,until,now);
          return {failures,until};
        });
        const until = Math.max(...records.map(record=>record.until));
        event(client,kind,'failed',now,records,until);
        saveReceipt(receiptId,null,until,now);
        sql.exec('DELETE FROM login_limit WHERE updated<=?',now-7*day);
        return until;
      });
    },
    success(client, kind, now, session, receiptId, nonce) {
      storage.transactionSync(()=>{
        for (const record of limits(client,now)) if (record.subject) sql.exec('DELETE FROM login_limit WHERE subject=?',record.subject);
        event(client,kind,'success',now);
        if (session) {
          sql.exec('DELETE FROM login_session WHERE expires<=? OR salt<>?',now,session.salt);
          sql.exec('INSERT INTO login_session(token,salt,expires) VALUES(?,?,?)',session.hash,session.salt,session.expires);
          saveReceipt(receiptId,nonce,0,now);
        }
      });
    },
    authorized(hash, salt, now) {
      return !!sql.exec('SELECT 1 FROM login_session WHERE token=? AND salt=? AND expires>?',hash,salt,now).toArray().length;
    },
    logout(hash) { sql.exec('DELETE FROM login_session WHERE token=?',hash); },
    history(kind, now) {
      sql.exec('DELETE FROM login_event WHERE at<=?',now-30*day);
      return sql.exec(`SELECT at,kind,outcome,device,ip,agent,deviceFailures,ipFailures,until FROM login_event
        WHERE kind=? ORDER BY id DESC LIMIT 100`,kind).toArray();
    },
  };
}
