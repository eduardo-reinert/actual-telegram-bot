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

r = parseMessage('25 cafe #alimentacao @nubank | cafe da equipe');
assert.equal(r.kind, 'tx'); assert.equal(r.payee, 'cafe');
assert.equal(r.category, 'alimentacao'); assert.equal(r.account, 'nubank');
assert.equal(r.note, 'cafe da equipe');

// transfers
r = parseMessage('200 @checking > @savings');
assert.equal(r.kind, 'transfer'); assert.equal(r.amount, 200);
assert.equal(r.from, 'checking'); assert.equal(r.to, 'savings');

r = parseMessage('R$ 1500,50 @conta_corrente -> @nubank_conta ontem #reserva');
assert.equal(r.kind, 'transfer'); assert.equal(r.amount, 1500.5);
assert.equal(r.from, 'conta corrente'); assert.equal(r.to, 'nubank conta'); assert.equal(r.category, 'reserva');

r = parseMessage('200 > @savings');           // from = active account
assert.equal(r.kind, 'transfer'); assert.equal(r.from, null); assert.equal(r.to, 'savings');

r = parseMessage('200 @checking >@savings aluguel');
assert.equal(r.from, 'checking'); assert.equal(r.to, 'savings'); assert.equal(r.note, 'aluguel');
r = parseMessage('200 @checking > @savings | reserva de emergencia #ignored');
assert.equal(r.note, 'reserva de emergencia #ignored');

r = parseMessage('200 @checking @savings', { forceTransfer: true });   // /transfer
assert.equal(r.kind, 'transfer'); assert.equal(r.from, 'checking'); assert.equal(r.to, 'savings');
r = parseMessage('200 @savings', { forceTransfer: true });
assert.equal(r.from, null); assert.equal(r.to, 'savings');
r = parseMessage('200', { forceTransfer: true });
assert.equal(r.to, null);

r = parseMessage('45 jantar @nubank');          // still a normal expense
assert.equal(r.kind, 'tx'); assert.equal(r.account, 'nubank');

assert.equal(parseMessage('oi tudo bem'), null);
assert.equal(parseMessage('0 nada'), null);
assert.deepEqual(parseMessage('/balance nubank'), { kind: 'cmd', name: 'balance', args: ['nubank'] });

const cats = [{ name: 'Alimentação' }, { name: 'Transporte' }];
assert.equal(findByName(cats, 'alimentacao').name, 'Alimentação');
assert.equal(findByName(cats, 'trans').name, 'Transporte');
assert.equal(findByName(cats, 'xyz'), null);

console.log('parser OK');
