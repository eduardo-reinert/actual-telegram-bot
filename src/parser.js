// Parses messages such as:
//   25.90 padaria
//   12,50 uber #transport @nubank ontem
//   +3000 salario
//   R$ 80 mercado 15/03
// Transfers (money between your own accounts):
//   200 @checking > @savings
//   200 > @savings          (from = active account)
const SEP_RE = /^(?:->|=>|→|>)(.*)$/;
const AMOUNT_RE = /^([+-])?(?:R\$|\$|€)?(\d+(?:[.,]\d{1,2})?)$/i;

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return fmt(d);
}

function parseDateToken(tok) {
  const t = tok.toLowerCase();
  if (['hoje', 'today'].includes(t)) return daysAgo(0);
  if (['ontem', 'yesterday'].includes(t)) return daysAgo(1);
  if (['anteontem'].includes(t)) return daysAgo(2);
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return t;
  m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (m) {
    const now = new Date();
    let y = m[3] ? Number(m[3]) : now.getFullYear();
    if (y < 100) y += 2000;
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${y}-${pad(month)}-${pad(day)}`;
  }
  return null;
}

/**
 * @param {{forceTransfer?: boolean}} opts  forceTransfer: used by /transfer, where no ">" is needed
 * @returns {null | {kind:'tx', amount:number, income:boolean, payee:string,
 *   category:string|null, account:string|null, date:string}
 *   | {kind:'transfer', amount:number, from:string|null, to:string|null,
 *      category:string|null, date:string, note:string}
 *   | {kind:'cmd', name:string, args:string[]}}
 * null = not for the bot (ignored silently)
 */
export function parseMessage(text, { forceTransfer = false } = {}) {
  if (!text) return null;
  const trimmed = text.trim();

  if (trimmed.startsWith('/')) {
    const [name, ...args] = trimmed.slice(1).split(/\s+/);
    return { kind: 'cmd', name: name.toLowerCase(), args };
  }

  const tokens = trimmed.split(/\s+/);
  let amountMatch = null;
  let amountIdx = -1;
  // amount can be the first token, or follow a lone "R$"
  for (let i = 0; i < Math.min(tokens.length, 2); i++) {
    const m = tokens[i].match(AMOUNT_RE);
    if (m) { amountMatch = m; amountIdx = i; break; }
    if (!/^(R\$|\$|€)$/i.test(tokens[i])) break;
  }
  if (!amountMatch) return null;

  const income = amountMatch[1] === '+';
  const amount = Number(amountMatch[2].replace(',', '.'));
  if (!(amount > 0)) return null;

  let category = null;
  let date = daysAgo(0);
  let sawSeparator = false;
  let sawNoteSeparator = false;
  const accounts = []; // { name, afterSeparator }
  const payeeParts = [];
  const noteParts = [];

  for (const raw of tokens.slice(amountIdx + 1)) {
    if (raw === '|') {
      sawNoteSeparator = true;
      continue;
    }
    if (sawNoteSeparator) {
      noteParts.push(raw);
      continue;
    }

    let tok = raw;
    const sep = tok.match(SEP_RE);
    if (sep) {
      sawSeparator = true;
      tok = sep[1];
      if (!tok) continue;
    }
    if (tok.startsWith('#') && tok.length > 1) category = tok.slice(1);
    else if (tok.startsWith('@') && tok.length > 1) {
      accounts.push({ name: tok.slice(1).replace(/_/g, ' '), afterSeparator: sawSeparator });
    } else {
      const d = parseDateToken(tok);
      if (d) date = d;
      else payeeParts.push(tok);
    }
  }

  if (sawSeparator || forceTransfer) {
    let from = null;
    let to = null;
    if (sawSeparator) {
      from = accounts.find((a) => !a.afterSeparator)?.name ?? null;
      to = accounts.find((a) => a.afterSeparator)?.name ?? null;
    } else if (accounts.length >= 2) {
      from = accounts[0].name;
      to = accounts[1].name;
    } else if (accounts.length === 1) {
      to = accounts[0].name; // "/transfer 200 @savings" -> from the active account
    }
    return {
      kind: 'transfer', amount, from, to, category, date,
      note: [...payeeParts, ...noteParts].join(' '),
    };
  }

  return {
    kind: 'tx', amount, income, payee: payeeParts.join(' '), note: noteParts.join(' '), category,
    account: accounts[0]?.name ?? null, date,
  };
}

/** Case/accent-insensitive lookup: exact match first, then "contains". */
export function findByName(items, query) {
  const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const q = norm(query);
  return (
    items.find((i) => norm(i.name) === q) ||
    items.find((i) => norm(i.name).startsWith(q)) ||
    items.find((i) => norm(i.name).includes(q)) ||
    null
  );
}
