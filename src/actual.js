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
  if (!acc) throw new Error(name ? `Account "${name}" not found` : 'No default account found');
  return acc;
}

export const listAccounts = () => serial(async () => {
  const out = [];
  for (const a of await openAccounts()) {
    out.push({ name: a.name, balance: api.utils.integerToAmount(await api.getAccountBalance(a.id)) });
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
    notes: 'via Telegram',
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

export const deleteTransaction = (id) => serial(async () => {
  await api.deleteTransaction(id);
  await api.sync();
});
