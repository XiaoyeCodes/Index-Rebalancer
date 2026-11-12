import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {InvestmentData as data} from '../investment-book.js';
import {verifyPagesPassword} from '../password-check.js';
const fixture=()=>({state:{weights:{SPY:100},holdings:{SPY:3},monthly:3000,investmentDay:11,mode:'hybrid',abs:5,rel:30,period:'Q',contributionMonth:'2026-11',lastExecutionDate:'2026-11-12',lastBalanceCheckDate:'2026-11-12',investmentResets:{monthly:{id:'reset',period:'2026-11'}},lastAppliedOps:{confirmedOn:'2026-11-12'},ledger:{date:'2026-11-01',cost:100,holdings:{SPY:3},positions:[{id:'SPY',quantity:1,price:100}],entries:[{date:'2026-11-12',flow:200,trades:[{id:'SPY',quantity:2,price:100}],investmentType:'monthly',operationId:'monthly:2026-11',period:'2026-11'}]}},templates:{'custom-test':{key:'custom-test',name:'测试模型',w:{SPY:100},rule:{mode:'hybrid',abs:5,rel:30,period:'Q'}}}});
test('clear removes all receipts, holdings, costs and grants while retaining monthly plan and models',()=>{
  const original=fixture(),before=structuredClone(original),next=data.clear(data.validate(original,['SPY']),'new-epoch');
  assert.deepEqual(original,before);assert.deepEqual(next.state.holdings,{});assert.equal(next.state.holdingsExample,false);
  for(const k of ['ledger','lastAppliedOps','contributionMonth','lastExecutionDate','lastBalanceCheckDate','investmentResets','beforeExample'])assert.equal(next.state[k],undefined);
  assert.equal(next.state.monthly,3000);assert.equal(next.state.investmentDay,11);assert.deepEqual(next.templates,before.templates);
  const restored=data.restore(data.validate(original,['SPY']),'restored-epoch');assert.deepEqual(restored.state.ledger,before.state.ledger);assert.equal(restored.state.investmentEpoch,'restored-epoch');
});
test('imports validate actual ledger and schedule fields and exclude unrelated credentials',()=>{
  const good=fixture();good.state.apiKey='secret';good.state.other='never-import';
  assert.equal(data.validate(good,['SPY']).state.apiKey,undefined);
  for(const corrupt of [b=>b.state.holdings.SPY=-1,b=>b.state.holdings.UNKNOWN=1,b=>b.state.monthly='3000',b=>b.state.ledger.entries[0].flow=NaN,b=>b.state.ledger.entries.push(structuredClone(b.state.ledger.entries[0])),b=>b.state.ledger.date='2026-02-30',b=>b.state.investmentDay=32,b=>b.state.investmentResets.monthly.period='2026-13']){const b=fixture();corrupt(b);assert.throws(()=>data.validate(b,['SPY']));}
});
test('password confirmation decrypts the existing login envelope and rejects a wrong password',async()=>{
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),iterations=1000;
  const raw=await crypto.subtle.importKey('raw',new TextEncoder().encode('fixture-password'),'PBKDF2',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations},raw,{name:'AES-GCM',length:256},false,['encrypt']);
  const sealed=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new Uint8Array([1,2,3]));
  const b64=x=>Buffer.from(x).toString('base64'),access={salt:b64(salt),iv:b64(iv),sealed:b64(sealed),iterations};
  assert.equal(await verifyPagesPassword(access,'fixture-password'),true);await assert.rejects(verifyPagesPassword(access,'wrong'),/密码不正确/);
});
function ui({badPassword=false,backupFailure=false}={}) {
  let book=fixture(),calls=[],closed=0;
  const nodes=new Map(),node=id=>{
    if(!nodes.has(id))nodes.set(id,{value:'',checked:false,disabled:false,hidden:false,textContent:'',classList:{toggle(){}},focus(){},addEventListener(){},showModal(){this.open=true;},close(){this.open=false;closed++;},click(){this.onclick?.();}});
    return nodes.get(id);
  };
  const sync={createBackup:async b=>{calls.push('backup');if(backupFailure)throw Error('备份失败');return {backup:{createdAt:'2026-11-12'}};},replaceBook:async(b,expected)=>{assert.deepEqual(expected,book);calls.push('replace');book=b;}};
  const context=vm.createContext({InvestmentData:data,IDS:['SPY'],$:node,document:{querySelectorAll:()=>[]},window:{privateAccount:{sync,verifyPassword:async()=>{calls.push('password');if(badPassword)throw Error('密码不正确');return true;}}},crypto,console});
  vm.runInContext(readFileSync(new URL('../investment-data-ui.js',import.meta.url),'utf8'),context);
  context.readBook=()=>structuredClone(book);vm.runInContext('currentInvestmentBook=readBook;bindInvestmentData();',context);
  return {nodes:node,calls,book:()=>book,change:()=>{book.state.monthly=900;},open:()=>node('#investmentDataClear').onclick(),submit:()=>node('#investmentDataForm').onsubmit({preventDefault(){}}),closed:()=>closed};
}
test('wrong password, failed optional backup, or changed data cannot clear investment records',async()=>{
  for(const options of [{badPassword:true},{backupFailure:true},{}]){
    const f=ui(options);f.open();f.nodes('#investmentDataPassword').value='fixture';if(!Object.keys(options).length)f.change();await f.submit();
    assert.equal(f.calls.includes('replace'),false);assert.equal(f.book().state.holdings.SPY,3);assert.ok(f.nodes('#investmentDataMessage').textContent);
  }
});
test('clear performs password check, verified backup, then one replacement; cancel is inert',async()=>{
  const f=ui();f.open();assert.equal(f.calls.length,0);f.nodes('#investmentDataCancel').onclick();assert.equal(f.calls.length,0);
  f.open();f.nodes('#investmentDataPassword').value='fixture';await Promise.all([f.submit(),f.submit()]);
  assert.deepEqual(f.calls,['password','backup','replace']);assert.deepEqual(f.book().state.holdings,{});assert.equal(f.book().state.ledger,undefined);assert.equal(f.nodes('#investmentDataPassword').value,'');
  const noBackup=ui();noBackup.open();noBackup.nodes('#backupBeforeClear').checked=false;await noBackup.submit();assert.deepEqual(noBackup.calls,['password','replace']);
});

test('a stale tab cannot save its old holdings after another tab clears or restores the account',()=>{
  const source=readFileSync(new URL('../src.html',import.meta.url),'utf8');
  const old=fixture().state,next=data.clear(fixture(),'changed-epoch').state;
  let written=false;
  const context=vm.createContext({S:old,ledgerRevision:'',investmentEpoch:'',structuredClone,defaultState:{weights:{SPY:100}},localStorage:{getItem:()=>JSON.stringify(next),setItem:()=>{written=true;}},window:{},toast(){}});
  vm.runInContext(source.slice(source.indexOf('const save = () => {'),source.indexOf('// Templates have their own storage')),context);
  assert.equal(vm.runInContext('save()',context),false);assert.equal(written,false);
  assert.equal(context.S.ledger,undefined);assert.deepEqual(JSON.parse(JSON.stringify(context.S.holdings)),{});assert.equal(context.S.investmentEpoch,'changed-epoch');
});
