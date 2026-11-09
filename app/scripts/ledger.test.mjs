import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const ledger = vm.runInNewContext(readFileSync(new URL('../ledger.js',import.meta.url),'utf8')+'\nLedger');
const price = symbol => ({SPY:100,GLD:50,VXUS:25})[symbol];

test('purchases, internal rebalancing and withdrawals have separate cash flows',()=>{
  const book=ledger.open({SPY:2,VXUS:2},'2026-01-01','2025-12-31',price,200);
  assert.equal(ledger.summary(book,price).profit,50);
  ledger.append(book,{SPY:1,GLD:2,VXUS:2},{flow:0});
  ledger.append(book,{SPY:1,GLD:3,VXUS:2},{flow:50});
  ledger.append(book,{SPY:0,GLD:3,VXUS:2},{flow:-110});
  const result=ledger.summary(book,price);
  assert.equal(result.value,200);
  assert.equal(result.invested,250);
  assert.equal(result.profit,60);
  assert.equal(result.rate,.24);
});
test('opening costs and old receipts are never inferred from the current price',()=>{
  const book=ledger.open({SPY:2},'2026-01-01','2025-12-31',price,null,{confirmedOn:'2025-12-15',note:'已核对'});
  assert.equal(ledger.summary(book,price).profit,undefined);
  assert.equal(book.legacy.date,'2025-12-15');
  assert.equal(ledger.summary(ledger.open({},'2026-01-01','2025-12-31',price,null),price).rate,null);
});
test('backfilled trades match opening positions and do not change holdings or double-count rotations',()=>{
  const book=ledger.open({SPY:1,GLD:2},'2026-01-01','2025-12-31',price,null);
  book.past=[{date:'2025-10-01',id:'SPY',quantity:2,flow:150},{date:'2025-11-01',id:'SPY',quantity:-1,flow:-100}];
  assert.equal(ledger.pastFlows(book),null);
  book.past.push({date:'2025-11-01',id:'GLD',quantity:2,flow:100});
  assert.equal(ledger.summary(book,price).profit,undefined);
  book.usePast=true;
  assert.equal(ledger.summary(book,price).invested,150);
  assert.equal(ledger.summary(book,price).profit,50);
  assert.equal(book.holdings.GLD,2);
});
