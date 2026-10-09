import * as api from '@actual-app/api';
import fs from 'node:fs';
import { findByName } from './parser.js';

const {
  ACTUAL_SERVER_URL, ACTUAL_PASSWORD, ACTUAL_SYNC_ID, ACTUAL_E2E_PASSWORD,
  ACTUAL_DATA_DIR = './data/actual', DEFAULT_ACCOUNT, APPLY_RULES = 'true',
} = process.env;

// Actual's local engine is not safe for concurrent calls: run everything one at a time.
let queue = Promise.resolve();
const serial = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

export async function start() {
  for (const [k, v] of Object.entries({ ACTUAL_SERVER_URL, ACTUAL_PASSWORD, ACTUAL_SYNC_ID })) {
    if (!v) throw new Error(`Missing env var ${k}`);
  }
  fs.mkdirSync(ACTUAL_DATA_DIR, { recursive: true });
  await api.init({ dataDir: ACTUAL_DATA_DIR, serverURL: ACTUAL_SERVER_URL, password: ACTUAL_PASSWORD });
  await api.downloadBudget(ACTUAL_SYNC_ID, ACTUAL_E2E_PASSWORD ? { password: ACTUAL_E2E_PASSWORD } : undefined);
}

export const stop = () => api.shutdown();

const openAccounts = async () => (await api.getAccounts()).filter((a) => !a.closed);

async function resolveAccount(name) {
  const accounts = await openAccounts();
  const acc = name ? findByName(accounts, name) : findByName(accounts, DEFAULT_ACCOUNT || '') || accounts[0];
  if (!acc) throw new Error(name ? `Account "${name}" not found (send /accounts)` : 'No default account found (send /accounts)');
  return acc;
}

export const listAccounts = () => serial(async () => {
  const accounts = await openAccounts();
  const def = findByName(accounts, DEFAULT_ACCOUNT || '') || accounts[0];
  const out = [];
  for (const a of accounts) {
    out.push({
      name: a.name,
      offbudget: !!a.offbudget,
      isDefault: a.id === def?.id,
      balance: api.utils.integerToAmount(await api.getAccountBalance(a.id)),
    });
  }
  return out;
});

export const listCategories = () => serial(async () => {
  const groups = await api.getCategoryGroups({ hidden: false });
  return groups.map((g) => ({ group: g.name, categories: g.categories.map((c) => c.name) }));
});

/** Flat, stable-ordered list of visible expense categories (for the picker buttons). */
export const listPickableCategories = () => serial(async () => {
  const cats = (await api.getCategories({ hidden: false })).filter((c) => !c.is_income);
  return cats.sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ id: c.id, name: c.name }));
});

export const getBalance = (accountName) => serial(async () => {
  const acc = await resolveAccount(accountName);
  return { name: acc.name, balance: api.utils.integerToAmount(await api.getAccountBalance(acc.id)) };
});

/** tx: output of parseMessage(); msgId makes the import idempotent. */
export const addTransaction = (tx, msgId) => serial(async () => {
  await api.sync(); // pull changes made from other devices first
  const account = await resolveAccount(tx.account);
  const allCats = await api.getCategories();

  let categoryId;
  if (tx.category) {
    const cat = findByName(allCats.filter((c) => !c.hidden), tx.category);
    if (!cat) throw new Error(`Category "${tx.category}" not found (send /categories)`);
    categoryId = cat.id;
  }

  const importedId = `telegram-${msgId}`;
  const cents = api.utils.amountToInteger(tx.amount) * (tx.income ? 1 : -1);
  const transaction = {
    account: account.id,
    date: tx.date,
    amount: cents,
    payee_name: tx.payee || undefined,
    category: categoryId,
    notes: tx.note ? `${tx.note} (via Telegram)` : 'via Telegram',
    imported_id: importedId,
    cleared: false,
  };

  let ids;
  if (APPLY_RULES === 'true') {
    const res = await api.importTransactions(account.id, [transaction], { defaultCleared: false });
    if (res.errors?.length) throw new Error(JSON.stringify(res.errors));
    ids = res.added;
  } else {
    ids = await api.addTransactions(account.id, [transaction]);
  }
  await api.sync();

  if (!ids?.length) return { duplicate: true, account: account.name };

  // Re-read the saved transaction: rules may have set payee/category for us.
  const saved = (await api.getTransactions(account.id, tx.date, tx.date)).find((t) => t.id === ids[0]);
  const category = saved?.category ? allCats.find((c) => c.id === saved.category) : null;
  return { id: ids[0], account: account.name, category: category?.name ?? null, cents };
});

export const setCategory = (txId, categoryId) => serial(async () => {
  await api.updateTransaction(txId, { category: categoryId });
  await api.sync();
});

/**
 * Money between two of your accounts. Actual models this as a pair of linked
 * transactions, created automatically when the source transaction uses the
 * destination account's "transfer payee".
 * t: output of parseMessage() with kind 'transfer' (t.to required).
 */
export const addTransfer = (t, msgId) => serial(async () => {
  if (!t.to) throw new Error('Missing destination account');
  await api.sync();
  const from = await resolveAccount(t.from);
  const to = await resolveAccount(t.to);
  if (from.id === to.id) throw new Error('Source and destination accounts are the same');

  const payee = (await api.getPayees()).find((p) => p.transfer_acct === to.id);
  if (!payee) throw new Error(`No transfer payee found for "${to.name}"`);

  const allCats = await api.getCategories();
  let categoryId;
  let categoryName = null;
  if (t.category) {
    const cat = findByName(allCats.filter((c) => !c.hidden), t.category);
    if (!cat) throw new Error(`Category "${t.category}" not found (send /categories)`);
    categoryId = cat.id;
    categoryName = cat.name;
  }

  const importedId = `telegram-${msgId}`;
  const cents = -api.utils.amountToInteger(t.amount);
  const res = await api.importTransactions(from.id, [{
    account: from.id,
    date: t.date,
    amount: cents,
    payee: payee.id,
    category: categoryId,
    notes: t.note ? `${t.note} (via Telegram)` : 'via Telegram',
    imported_id: importedId,
    cleared: false,
  }], { defaultCleared: false });
  if (res.errors?.length) throw new Error(JSON.stringify(res.errors));
  await api.sync();

  if (!res.added?.length) return { duplicate: true };

  const saved = (await api.getTransactions(from.id, t.date, t.date)).find((x) => x.imported_id === importedId);
  return {
    id: saved?.id ?? res.added[0],
    from: from.name,
    to: to.name,
    cents,
    category: categoryName,
    // on-budget -> off-budget leaves the budget: Actual wants a category for it
    needsCategory: !from.offbudget && !!to.offbudget,
  };
});

/** Deletes a transaction; for transfers, also deletes the linked transaction on the other account. */
export const deleteTransaction = (id) => serial(async () => {
  const { data } = await api.runQuery(api.q('transactions').filter({ id }).select(['id', 'transfer_id']));
  await api.deleteTransaction(id);
  const other = data?.[0]?.transfer_id;
  if (other) await api.deleteTransaction(other);
  await api.sync();
});
