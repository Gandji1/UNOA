import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveParameter} from '../packages/config/src/resolve.ts';

const at = '2026-11-19T09:00:00Z';
const globalRule = {key:'duration',scope:'global',effectiveFrom:'2026-01-01T00:00:00Z',state:'published',version:1,value:16};
const local = {...globalRule,scope:'pilot-a',value:12};
const rows = [globalRule,local,{...local,version:2,value:14,effectiveFrom:'2026-12-01T00:00:00Z'}, {...local,state:'draft',version:3,value:99}];

test('La portée la plus spécifique fournit sa provenance',()=>{
  assert.deepEqual(resolveParameter('duration',['pilot-a','global'],at,rows),local);
});
test('Un autre territoire hérite de la valeur globale',()=>{
  assert.deepEqual(resolveParameter('duration',['pilot-b','global'],at,rows),globalRule);
});
test('Une version future entre en vigueur à la date prévue',()=>{
  assert.equal(resolveParameter('duration',['pilot-a','global'],'2026-12-01T00:00:00Z',rows).value,14);
});
test('Une règle expirée ou une autre clé est exclue',()=>{
  assert.equal(resolveParameter('duration',['global'],at,[{...globalRule,effectiveUntil:at}]),null);
  assert.equal(resolveParameter('unconfigured',['global'],at,rows),null);
});
test('Un instant ambigu ou invalide est rejeté',()=>{
  for(const date of ['incorrect','2026-11-19','2026-11-19T10:00:00']) {
    assert.throws(()=>resolveParameter('duration',['global'],date,rows),RangeError);
  }
});
