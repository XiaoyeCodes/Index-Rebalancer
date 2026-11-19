import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { loginStore } from './login-store.js';

const minute=60000, day=24*60*minute;
const client={device:'browser-1',ip:'192.0.2.1',agent:'Example agent'};

function withStore(testBody) {
  const db=new DatabaseSync(':memory:');
  const storage={sql:{exec(query,...values){
    if (query.startsWith('CREATE')) {db.exec(query);return;}
    const stmt=db.prepare(query);
    if (query.startsWith('SELECT')) return {toArray:()=>stmt.all(...values).map(row=>({...row}))};
    stmt.run(...values);
  }},transactionSync(action){
    db.exec('BEGIN');
    try {const result=action();db.exec('COMMIT');return result;}
    catch (error) {db.exec('ROLLBACK');throw error;}
  }};
  try {testBody(loginStore(storage));}finally{db.close();}
}

test('four failures per round trigger 10 minutes, then 30 minutes, then a day',()=>withStore(store=>{
  let now=Date.UTC(2026,10,19),until;
  for(const duration of [10*minute,30*minute,day,day]) {
    for(let i=0;i<3;i++) {
      assert.equal(store.check(client,'login',now),0);
      assert.equal(store.fail(client,'login',now++),0);
    }
    until=store.fail(client,'login',now);
    assert.equal(until,now+duration);
    assert.equal(store.check(client,'login',now+1),until);
    assert.equal(store.check(client,'login',until),0);
    now=until;
  }
  const events=store.history('login',now);
  assert.equal(events.filter(e=>e.outcome==='failed').length,16);
  assert.equal(events.filter(e=>e.outcome==='blocked').length,4);
  assert.equal(events[0].ipFailures,4);
}));

test('a matching device or IP inherits its cooldown and successful verification resets both',()=>withStore(store=>{
  const now=Date.UTC(2026,10,19);
  for(let i=0;i<4;i++) store.fail(client,'login',now+i);
  const until=now+3+10*minute;
  assert.equal(store.check({...client,device:'browser-2'},'login',now+10),until);
  assert.equal(store.check({...client,ip:'192.0.2.2'},'verify',now+10),until);
  assert.equal(store.check({...client,device:'browser-3',ip:'192.0.2.3'},'login',now+10),0);
  store.success(client,'verify',until);
  assert.equal(store.fail(client,'login',until),0);
  const [latest]=store.history('login',until);
  assert.equal(latest.deviceFailures,1);
  assert.equal(latest.ipFailures,1);
}));

test('views, attempts and password confirmations are distinguishable and expire after 30 days',()=>withStore(store=>{
  const now=Date.UTC(2026,10,19);
  store.visit(client,now);
  store.fail(client,'login',now+1);
  store.success(client,'verify',now+2);
  assert.deepEqual(store.history('visit',now+2),[{at:now,kind:'visit',outcome:'opened',...client,deviceFailures:0,ipFailures:0,until:0}]);
  assert.equal(store.history('login',now+2)[0].outcome,'failed');
  assert.equal(store.history('verify',now+2)[0].outcome,'success');
  assert.deepEqual(store.history('visit',now+30*day),[]);
}));

test('sessions expire, can be revoked, and are invalidated by a password salt change',()=>withStore(store=>{
  const now=Date.UTC(2026,10,19);
  const session={hash:'token-hash',salt:'salt',expires:now+day};
  store.success(client,'login',now,session);
  assert.equal(store.authorized(session.hash,session.salt,now+1),true);
  assert.equal(store.authorized(session.hash,'new-salt',now+1),false);
  assert.equal(store.authorized(session.hash,session.salt,now+day),false);
  store.logout(session.hash);
  assert.equal(store.authorized(session.hash,session.salt,now+2),false);
}));
