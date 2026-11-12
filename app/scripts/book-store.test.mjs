import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {bookStore} from '../../sync/book-store.js';
function fixture() {
  const db=new DatabaseSync(':memory:');let fail=false;
  const storage={sql:{exec(query,...values){
    if(fail&&query.startsWith('INSERT OR REPLACE INTO book_generation'))throw Error('storage failure');
    const statement=db.prepare(query);
    if(query.startsWith('SELECT')){const rows=statement.all(...values).map(r=>({...r}));return {toArray:()=>rows,one:()=>rows[0]};}
    statement.run(...values);return {toArray:()=>[]};
  }},transactionSync(action){db.exec('BEGIN IMMEDIATE');try{const result=action();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};
  const store=bookStore(storage);return {store,db,fail:()=>{fail=true;}};
}
test('reset generations persist and reject stale or legacy writes even with the latest revision',()=>{
  const f=fixture();try{
    assert.deepEqual(f.store.read(-1),{revision:0,generation:0});
    assert.deepEqual(f.store.write(0,'old-ciphertext',0),{revision:1,generation:0});
    assert.deepEqual(f.store.write(1,'cleared-ciphertext',0,true),{revision:2,generation:1});
    assert.equal(f.store.write(2,'revive-old-holdings',0),null);
    assert.equal(f.store.write(2,'legacy-client-without-generation'),null);
    assert.equal(f.store.write(1,'competing-write',1),null);
    assert.deepEqual(f.store.read(-1),{revision:2,generation:1,blob:'cleared-ciphertext'});
    assert.deepEqual(f.store.write(2,'restored-ciphertext',1,true),{revision:3,generation:2});
    assert.deepEqual(f.store.read(3),{revision:3,generation:2});
  } finally {f.db.close();}
});
test('a storage failure cannot commit a new book without its matching reset generation',()=>{
  const f=fixture();try{
    f.store.write(0,'original',0);f.fail();assert.throws(()=>f.store.write(1,'clear',0,true),/storage failure/);
    assert.deepEqual(f.store.read(-1),{revision:1,generation:0,blob:'original'});
  } finally {f.db.close();}
});
