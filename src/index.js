import { Bot, InlineKeyboard } from 'grammy';
import * as actual from './actual.js';
import { parseMessage } from './parser.js';
import { getActiveAccount, setActiveAccount } from './state.js';

const {
  TELEGRAM_BOT_TOKEN, ALLOWED_USER_IDS = '', CURRENCY = 'BRL', LOCALE = 'pt-BR',
} = process.env;
if (!TELEGRAM_BOT_TOKEN) throw new Error('Missing env var TELEGRAM_BOT_TOKEN');

const allowed = new Set(ALLOWED_USER_IDS.split(',').map((s) => s.trim()).filter(Boolean));
if (!allowed.size) console.warn('⚠️  ALLOWED_USER_IDS is empty: only /id works until you set it.');

const money = (n) => n.toLocaleString(LOCALE, { style: 'currency', currency: CURRENCY });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const HTML = { parse_mode: 'HTML' };

const HELP = `<b>Actual Budget bot</b>

<b>Add a transaction</b>
<code>25.90 padaria</code>
<code>12,50 uber #transporte @nubank ontem</code>
<code>+3000 salário</code> (income)
<code>80 mercado 15/03</code>
<code>25 cafe | cafe da equipe</code> (note)

<b>Transfer between accounts</b>
<code>200 @checking &gt; @savings</code>
<code>200 &gt; @savings</code> (from the active account)
<code>/transfer 200 @checking @savings</code>

• <code>#category</code> · <code>@account</code> · date: hoje, ontem, dd/mm, dd/mm/aaaa
• Add <code>| note</code> to store a custom note without changing the payee
• No @account → your active account (see /accounts)
• Account names with spaces: <code>@conta_corrente</code>
• Use the buttons under each confirmation to undo or set a category

<b>Commands</b>
/accounts – view accounts and choose the active one
/transfer – move money between accounts
/categories – list categories
/balance [account] – balance of an account
/undo – delete the last transaction (both sides of a transfer)
/id – show your Telegram user ID
/help – show this message`;

const TRANSFER_USAGE =
  'Usage: <code>200 @from &gt; @to</code> or <code>/transfer 200 @from @to</code>\n' +
  'Without @from the active account is used (see /accounts). Add <code>#category</code> or a date if needed.';

const bot = new Bot(TELEGRAM_BOT_TOKEN);
const lastTx = new Map(); // userId -> last transaction id (for /undo)

// Open to everyone: lets you discover your numeric ID during setup.
bot.command(['id', 'start'], (ctx) =>
  ctx.reply(`Your Telegram user ID is ${ctx.from.id}\nPut it in ALLOWED_USER_IDS to use this bot.`));

// Everything below requires an allowed user.
bot.use(async (ctx, next) => {
  if (allowed.has(String(ctx.from?.id))) return next();
  console.warn('Ignored update from unauthorised user', ctx.from?.id);
  if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});
});

bot.command(['help', 'ajuda'], (ctx) => ctx.reply(HELP, HTML));

// Builds the /accounts message + one button per account.
async function accountsView(userId) {
  const list = await actual.listAccounts();
  const active = getActiveAccount(userId);
  const current = list.find((a) => a.name === active) ?? list.find((a) => a.isDefault) ?? list[0];

  const lines = list.map((a) => {
    const tag = a.name.trim().replace(/\s+/g, '_');
    return `${a === current ? '✅' : '▫️'} <b>${esc(a.name)}</b>${a.offbudget ? ' <i>(off budget)</i>' : ''}\n` +
           `     ${money(a.balance)} · <code>@${esc(tag)}</code>`;
  });

  const kb = new InlineKeyboard();
  list.forEach((a, i) => {
    kb.text(`${a === current ? '✅ ' : ''}${a.name}`, `a:${i}`);
    if (i % 2 === 1) kb.row();
  });
  if (list.length % 2 === 1) kb.row();
  kb.text('↺ Use default', 'a:default');

  const text =
    `<b>Accounts</b>\n\n${lines.join('\n')}\n\n` +
    `Current account for new transactions: <b>${esc(current?.name ?? '?')}</b>\n` +
    `Tap an account to change it, or add <code>@tag</code> to a single message.`;
  return { text, kb, list };
}

bot.command(['accounts', 'contas'], async (ctx) => {
  const { text, kb } = await accountsView(ctx.from.id);
  await ctx.reply(text, { ...HTML, reply_markup: kb });
});

bot.callbackQuery(/^a:(default|\d+)$/, async (ctx) => {
  const choice = ctx.match[1];
  const list = await actual.listAccounts();
  if (choice === 'default') {
    setActiveAccount(ctx.from.id, null);
  } else {
    const acc = list[Number(choice)];
    if (!acc) return ctx.answerCallbackQuery({ text: 'Account list changed, send /accounts again' });
    setActiveAccount(ctx.from.id, acc.name);
  }
  const { text, kb } = await accountsView(ctx.from.id);
  await ctx.answerCallbackQuery({ text: 'Account updated' });
  await ctx.editMessageText(text, { ...HTML, reply_markup: kb });
});

bot.command(['categories', 'categorias'], async (ctx) => {
  const groups = await actual.listCategories();
  await ctx.reply(
    groups.map((g) => `<b>${esc(g.group)}</b>\n${g.categories.map((c) => `  • ${esc(c)}`).join('\n')}`).join('\n\n'),
    HTML,
  );
});

bot.command(['balance', 'saldo'], async (ctx) => {
  const b = await actual.getBalance(ctx.match?.trim() || undefined);
  await ctx.reply(`${esc(b.name)}: <b>${money(b.balance)}</b>`, HTML);
});

bot.command(['undo', 'desfazer'], async (ctx) => {
  const id = lastTx.get(ctx.from.id);
  if (!id) return ctx.reply('Nothing to undo.');
  await actual.deleteTransaction(id);
  lastTx.delete(ctx.from.id);
  await ctx.reply('↩️ Last transaction deleted.');
});

// ---- transfers between your own accounts ----
async function doTransfer(ctx, parsed) {
  if (!parsed.to) return ctx.reply(TRANSFER_USAGE, HTML);
  parsed.from = parsed.from ?? getActiveAccount(ctx.from.id); // null → DEFAULT_ACCOUNT

  const r = await actual.addTransfer(parsed, `${ctx.chat.id}-${ctx.message.message_id}`);
  if (r.duplicate) return ctx.reply('That message was already imported (duplicate ignored).');

  lastTx.set(ctx.from.id, r.id);
  const kb = new InlineKeyboard().text('↩️ Undo', `u:${r.id}`);
  if (r.needsCategory && !r.category) kb.text('🏷 Set category', `p:${r.id}`);

  await ctx.reply(
    `🔁 Transfer <b>${money(Math.abs(r.cents) / 100)}</b>\n` +
    `From: ${esc(r.from)}\n` +
    `To: ${esc(r.to)}\n` +
    (parsed.note ? `Note: ${esc(parsed.note)}\n` : '') +
    (r.needsCategory || r.category ? `Category: ${r.category ? esc(r.category) : '<i>none</i>'}\n` : '') +
    `Date: ${parsed.date}`,
    { ...HTML, reply_markup: kb },
  );
}

bot.command(['transfer', 'transferir'], async (ctx) => {
  const parsed = parseMessage(ctx.match ?? '', { forceTransfer: true });
  if (!parsed) return ctx.reply(TRANSFER_USAGE, HTML);
  await doTransfer(ctx, parsed);
});

// ---- plain text: "25.90 padaria" ----
bot.on('message:text', async (ctx) => {
  const parsed = parseMessage(ctx.message.text);
  if (!parsed) return ctx.reply('I didn\'t understand. Try <code>25.90 padaria</code> or /help', HTML);
  if (parsed.kind === 'cmd') return ctx.reply('Unknown command. Send /help');
  if (parsed.kind === 'transfer') return doTransfer(ctx, parsed);

  if (!parsed.account) parsed.account = getActiveAccount(ctx.from.id); // null → DEFAULT_ACCOUNT
  const r = await actual.addTransaction(parsed, `${ctx.chat.id}-${ctx.message.message_id}`);
  if (r.duplicate) return ctx.reply('That message was already imported (duplicate ignored).');

  lastTx.set(ctx.from.id, r.id);
  const kb = new InlineKeyboard().text('↩️ Undo', `u:${r.id}`);
  if (!r.category && r.cents < 0) kb.text('🏷 Set category', `p:${r.id}`);

  await ctx.reply(
    `✅ ${r.cents < 0 ? 'Expense' : 'Income'} <b>${money(Math.abs(r.cents) / 100)}</b>\n` +
    (parsed.payee ? `Payee: ${esc(parsed.payee)}\n` : '') +
    (parsed.note ? `Note: ${esc(parsed.note)}\n` : '') +
    `Account: ${esc(r.account)}\n` +
    `Category: ${r.category ? esc(r.category) : '<i>none</i>'}\n` +
    `Date: ${parsed.date}`,
    { ...HTML, reply_markup: kb },
  );
});

// ---- buttons ----
bot.callbackQuery(/^u:(.+)$/, async (ctx) => {
  await actual.deleteTransaction(ctx.match[1]);
  if (lastTx.get(ctx.from.id) === ctx.match[1]) lastTx.delete(ctx.from.id);
  await ctx.answerCallbackQuery({ text: 'Deleted' });
  await ctx.editMessageText('↩️ Transaction deleted.');
});

// "Set category" → show the category picker
bot.callbackQuery(/^p:(.+)$/, async (ctx) => {
  const txId = ctx.match[1];
  const cats = await actual.listPickableCategories();
  const kb = new InlineKeyboard();
  cats.slice(0, 90).forEach((c, i) => {
    kb.text(c.name, `c:${txId}:${i}`);
    if (i % 2 === 1) kb.row();
  });
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({ reply_markup: kb });
});

// category chosen
bot.callbackQuery(/^c:([^:]+):(\d+)$/, async (ctx) => {
  const [, txId, idx] = ctx.match;
  const cat = (await actual.listPickableCategories())[Number(idx)];
  if (!cat) return ctx.answerCallbackQuery({ text: 'Category list changed, try again' });
  await actual.setCategory(txId, cat.id);
  await ctx.answerCallbackQuery({ text: cat.name });
  const base = ctx.callbackQuery.message?.text ?? '';
  const updated = base.replace(/Category: .*/, `Category: ${cat.name}`);
  await ctx.editMessageText(esc(updated), {
    ...HTML,
    reply_markup: new InlineKeyboard().text('↩️ Undo', `u:${txId}`),
  });
});

bot.catch(async ({ error, ctx }) => {
  console.error(error);
  await ctx.reply(`❌ ${error.message ?? error}`).catch(() => {});
});

// ---- start ----
await actual.start();
console.log('✅ Actual Budget loaded');

await bot.api.setMyCommands([
  { command: 'accounts', description: 'View accounts and choose the active one' },
  { command: 'transfer', description: 'Move money between accounts' },
  { command: 'categories', description: 'List categories' },
  { command: 'balance', description: 'Balance of an account' },
  { command: 'undo', description: 'Delete the last transaction or transfer' },
  { command: 'help', description: 'How to use the bot' },
]);

const bye = async () => { await bot.stop(); await actual.stop().catch(() => {}); process.exit(0); };
process.on('SIGINT', bye);
process.on('SIGTERM', bye);

await bot.start({ onStart: (me) => console.log(`✅ Telegram bot @${me.username} running`) });
