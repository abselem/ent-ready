import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENTAnswerQueue } from '../src/app/student/ent/answer-queue.ts';

function deferred() {
  let resolve, reject;
  const promise = new Promise((a,b)=>{resolve=a;reject=b;});
  return {promise,resolve,reject};
}

test('ENT coalesces multiple selections and finish waits for the last write', async () => {
  const first=deferred(), latest=deferred(), calls=[], states=[];
  const queue=new ENTAnswerQueue(async (id,options)=>{
    calls.push({id,options});
    await (calls.length===1 ? first.promise : latest.promise);
  }, (id,status)=>states.push({id,status}));
  queue.choose(1,[10]); await Promise.resolve();
  queue.choose(1,[10,11]); queue.choose(1,[11,12]);
  let finished=false; const finish=queue.flush().then(value=>{finished=true;return value;});
  first.resolve(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(finished,false);
  assert.deepEqual(calls,[{id:1,options:[10]},{id:1,options:[11,12]}]);
  latest.resolve(); assert.equal(await finish,true);
  assert.deepEqual(states.at(-1),{id:1,status:'saved'});
});

test('ENT failed write blocks finish until an explicit retry succeeds', async () => {
  let fail=true;const states=[];
  const queue=new ENTAnswerQueue(async()=>{if(fail) throw Error('offline');},(_id,status)=>states.push(status));
  queue.choose(1,[3]); assert.equal(await queue.flush(),false);
  assert.equal(states.at(-1),'error');
  fail=false; queue.choose(1,[3]); assert.equal(await queue.flush(),true);
  assert.equal(states.at(-1),'saved');
});

test('ENT disposed attempt cannot send queued selections or notify the next screen', async () => {
  const pending=deferred();let calls=0,notifications=0;
  const queue=new ENTAnswerQueue(async()=>{calls++;await pending.promise;},()=>notifications++);
  queue.choose(1,[3]);await Promise.resolve();queue.choose(1,[4]);
  queue.dispose();const previous=notifications;pending.resolve();await queue.flush();
  queue.choose(1,[5]);assert.equal(calls,1);assert.equal(notifications,previous);
});
