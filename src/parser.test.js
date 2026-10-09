import assert from 'node:assert/strict';
import { parseMessage, findByName } from './parser.js';

let r = parseMessage('25.90 padaria');
assert.equal(r.amount, 25.9); assert.equal(r.income, false); assert.equal(r.payee, 'padaria');

r = parseMessage('12,50 uber eats #transporte @nubank ontem');
assert.equal(r.amount, 12.5); assert.equal(r.payee, 'uber eats');
assert.equal(r.category, 'transporte'); assert.equal(r.account, 'nubank');

r = parseMessage('+3000 Salário');
assert.equal(r.income, true); assert.equal(r.amount, 3000);

r = parseMessage('R$ 80 mercado 15/03/2025');
assert.equal(r.amount, 80); assert.equal(r.date, '2025-03-15'); assert.equal(r.payee, 'mercado');

r = parseMessage('R$80 farmácia');
assert.equal(r.amount, 80);

r = parseMessage('30 jantar @conta_corrente');
assert.equal(r.account, 'conta corrente');

assert.equal(parseMessage('oi tudo bem'), null);
assert.equal(parseMessage('0 nada'), null);
assert.deepEqual(parseMessage('/balance nubank'), { kind: 'cmd', name: 'balance', args: ['nubank'] });

const cats = [{ name: 'Alimentação' }, { name: 'Transporte' }];
assert.equal(findByName(cats, 'alimentacao').name, 'Alimentação');
assert.equal(findByName(cats, 'trans').name, 'Transporte');
assert.equal(findByName(cats, 'xyz'), null);

console.log('parser OK');
