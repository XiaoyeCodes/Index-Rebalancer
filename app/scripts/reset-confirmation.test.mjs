import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../src.html',import.meta.url),'utf8');
const Investment=vm.runInNewContext(readFileSync(new URL('../investment.js',import.meta.url),'utf8')+'\nInvestment');
function fixture(state={}) {
  let today='2026-11-12',calls=[];
  const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}};
  const nodes={'#investmentResetConfirm':dialog,'#investmentResetSubmit':{},'#investmentResetCancel':{},'#investmentResetConfirmTitle':{},'#investmentResetConfirmIntro':{},'#investmentResetStatus':{}};
  const context=vm.createContext({S:state,Investment,$:id=>nodes[id],todayStr:()=>today,renderResetSettings:()=>{},resetInvestmentAction:async kind=>{calls.push(kind);}});
  vm.runInContext(source.slice(source.indexOf('let resetConfirmation ='),source.indexOf('async function resetInvestmentAction(')),context);
  const open=kind=>{context.kind=kind;vm.runInContext('openInvestmentReset(kind)',context);};
  const confirm=()=>vm.runInContext('confirmInvestmentReset({preventDefault(){}})',context);
  return {state,dialog,nodes,open,confirm,calls,day:value=>{today=value;}};
}
test('opening or cancelling either reset confirmation leaves the account state untouched',()=>{
  for(const kind of ['monthly','rebalance']) {
    const f=fixture({contributionMonth:'2026-11',lastBalanceCheckDate:'2026-11-11'}),before=JSON.stringify(f.state);
    f.open(kind);assert.equal(f.dialog.open,true);assert.equal(f.calls.length,0);
    f.dialog.close();assert.equal(JSON.stringify(f.state),before);assert.equal(f.calls.length,0);
  }
});
test('confirming grants only the chosen operation once, including rapid duplicate submissions',async()=>{
  for(const kind of ['monthly','rebalance']) {
    const f=fixture();f.open(kind);await Promise.all([f.confirm(),f.confirm()]);
    assert.deepEqual(f.calls,[kind]);assert.equal(f.dialog.open,false);
    await f.confirm();assert.deepEqual(f.calls,[kind]);
  }
});
test('a date change or an existing pending opportunity cannot silently unlock another operation',async()=>{
  const f=fixture();f.open('monthly');f.day('2026-11-13');await f.confirm();
  assert.equal(f.calls.length,0);assert.match(f.nodes['#investmentResetStatus'].textContent,/日期已变化/);
  const pending=fixture({investmentResets:{rebalance:{id:'pending',period:'2026-11'}}});
  pending.open('rebalance');assert.equal(pending.dialog.open,false);assert.equal(pending.calls.length,0);
});
