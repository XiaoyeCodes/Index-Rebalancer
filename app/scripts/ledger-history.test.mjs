import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const {ledgerHistoryRecords:records,paginateLedgerHistory:paginate} = vm.runInNewContext(
  readFileSync(new URL('../ledger-ui.js',import.meta.url),'utf8')+'\n({ledgerHistoryRecords,paginateLedgerHistory})');
const ledger = vm.runInNewContext(readFileSync(new URL('../ledger.js',import.meta.url),'utf8')+'\nLedger');
const json = value => JSON.parse(JSON.stringify(value));
const bookWith = count => ({date:'2026-10-01',positions:[],holdings:{},cost:0,
  entries:Array.from({length:count},(_,i)=>({date:`2026-11-${String(i+1).padStart(2,'0')}`,key:i,flow:0,trades:[]}))});

test('every record appears once across pages capped at ten, including the opening balance',()=>{
  const source=records(bookWith(25)), first=paginate(source), second=paginate(source,'','',2), last=paginate(source,'','',3);
  assert.deepEqual([first.rows.length,second.rows.length,last.rows.length],[10,10,6]);
  assert.equal(first.total,26);assert.equal(first.pages,3);
  assert.equal(first.rows[0].date,'2026-11-25');assert.equal(last.rows.at(-1).type,'opening');
  assert.deepEqual(json([...first.rows,...second.rows,...last.rows]),json(source));
  assert.equal(paginate(records(bookWith(9))).pages,1);
  assert.equal(paginate(records(bookWith(10))).pages,2);
});

test('date ranges include both boundaries and filter opening, past and legacy records together',()=>{
  const book={date:'2026-11-02',positions:[],entries:[{date:'2026-11-03'},{date:'2026-11-03'}],
    past:[{date:'2026-11-01',key:'past'}]};
  const source=records(book,{confirmedOn:'2026-10-31'}), range=paginate(source,'2026-11-01','2026-11-02');
  assert.deepEqual(Array.from(range.rows,row=>row.type),['opening','past']);
  assert.equal(paginate(source,'2026-11-03','2026-11-03').total,2);
  assert.equal(paginate(source,'2026-11-02').total,3);
  assert.equal(paginate(source,'','2026-11-01').total,2);
  assert.equal(paginate(source,'2026-10-31','2026-10-31').rows[0].type,'legacy');
  assert.equal(source[0].value,book.entries[1]); // newest confirmation first on the same date
});

test('empty results, invalid ranges and removed last-page records have safe page boundaries',()=>{
  const source=records(bookWith(10));
  assert.equal(paginate(source,'','',99).page,2);
  assert.equal(paginate(source,'','',-4).page,1);
  assert.equal(paginate(source.slice(0,10),'','',2).page,1);
  const empty=paginate(source,'2027-01-01','2027-01-31',2);
  assert.equal(empty.total,0);assert.equal(empty.page,1);assert.equal(empty.pages,1);assert.equal(empty.rows.length,0);
  const invalid=paginate(source,'2026-11-10','2026-11-01');
  assert.equal(invalid.invalid,true);assert.equal(invalid.rows.length,0);
  assert.equal(paginate(records(null)).total,0);
});

test('sorting and filtering never change stored receipts, holdings or whole-account return calculations',()=>{
  const book=ledger.open({SPY:2},'2026-10-01','2026-10-01',()=>100,150);
  ledger.append(book,{SPY:3},{date:'2026-11-01',flow:100,trades:[]});
  const before=JSON.stringify(book), totals=json(ledger.summary(book,()=>100));
  paginate(records(book),'2026-11-01','2026-11-01');
  assert.equal(JSON.stringify(book),before);
  assert.deepEqual(json(ledger.summary(book,()=>100)),totals);
  assert.equal(totals.profit,50);
});

test('undated legacy receipts stay readable without a filter and example receipts are excluded',()=>{
  const source=records(null,{note:'old receipt'});
  assert.equal(paginate(source).total,1);
  assert.equal(paginate(source,'2026-01-01').total,0);
  assert.equal(paginate(source,'','2026-11-30').total,0);
  assert.equal(records(null,{example:true,confirmedOn:'2026-11-01'}).length,0);
});
