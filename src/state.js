import fs from 'node:fs';
import path from 'node:path';

const dir = process.env.STATE_DIR || './data';
const file = path.join(dir, 'state.json');

let state = {};
try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }

const save = () => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
};

/** Account name chosen by the user via /accounts, or null to use DEFAULT_ACCOUNT. */
export const getActiveAccount = (userId) => state[userId]?.activeAccount ?? null;

export function setActiveAccount(userId, name) {
  state[userId] = { ...state[userId], activeAccount: name };
  if (name === null) delete state[userId].activeAccount;
  save();
}
