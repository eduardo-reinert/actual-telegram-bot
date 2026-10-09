# Actual Budget × Telegram bot

Send a Telegram message, get a transaction in Actual Budget.

```
25.90 padaria                      → expense, payee "padaria", active account
12,50 uber #transporte @nubank     → explicit category and account
+3000 salário                      → income
80 mercado ontem                   → date: hoje, ontem, dd/mm, dd/mm/aaaa
200 @checking > @savings           → transfer between your own accounts
```

Actual only ships a Node.js client (no HTTP API), so the bot is Node.js too.

## Contents
- [Bot reference](#bot-reference)
- [Setup](#setup)
- [Notes](#notes)

---

## Bot reference

### Commands

| Command | Alias | Who can use it | What it does |
| --- | --- | --- | --- |
| `/id` | `/start` | **Everyone** | Replies with your numeric Telegram user ID. Use it once during setup to fill in `ALLOWED_USER_IDS`. |
| `/help` | `/ajuda` | Allowed users | Shows the usage guide and the command list. |
| `/accounts` | `/contas` | Allowed users | Lists every open account with its balance and `@tag`, and lets you pick the **active account** with buttons. |
| `/transfer <amount> [@from] @to` | `/transferir` | Allowed users | Moves money between two of your accounts (see [Transfers](#transfers-between-accounts)). |
| `/categories` | `/categorias` | Allowed users | Lists all visible categories, grouped by category group. |
| `/balance [account]` | `/saldo` | Allowed users | Balance of one account. Without an argument it uses your default account. Write the name with spaces, e.g. `/balance conta corrente`. Partial names work (`/balance nu`). |
| `/undo` | `/desfazer` | Allowed users | Deletes the last transaction or transfer you added through the bot (both sides of a transfer). |

Anyone not in `ALLOWED_USER_IDS` is ignored, except for `/id` and `/start`. Any other `/command` gets *"Unknown command. Send /help"*.

The Telegram command menu (the `/` button) shows: `/accounts`, `/transfer`, `/categories`, `/balance`, `/undo`, `/help`.

### Adding a transaction

Send a plain message (no slash). The amount must come first; everything else is optional and can be in any order after it.

```
<amount> [payee words] [#category] [@account] [date] [| note]
```

| Part | Format | Examples |
| --- | --- | --- |
| **Amount** | Number with `.` or `,` and up to 2 decimals. No thousands separator (write `1234,56`, not `1.234,56`). Optional `R$`, `$` or `€` prefix. | `25.90` · `25,90` · `R$ 25,90` · `R$25` |
| **Type** | Expense by default. A leading `+` makes it income. | `+3000 salário` |
| **Payee** | Any remaining words. Actual creates the payee if it doesn't exist. | `uber eats` |
| **Category** | `#` plus one word. Case and accent insensitive; a partial name works if unambiguous. Must be a single word, so for "Fast Food" use `#fast`. | `#transporte` · `#alimentacao` |
| **Account** | `@` plus the account tag. Underscores stand in for spaces. Overrides the active account for this message only. | `@nubank` · `@conta_corrente` |
| **Date** | Defaults to today. | `hoje` · `ontem` · `anteontem` · `15/03` · `15/03/2025` · `2025-03-15` |
| **Note** | Optional text after `|`. The text before it remains the payee; everything after it is stored as the transaction note. | `25 cafe | cafe da equipe` |

More examples:

```
25.90 padaria
12,50 uber #transporte @nubank ontem
+3000 salário
R$ 80 mercado 15/03
45 jantar @conta_corrente hoje
25 cafe #alimentacao | cafe da equipe
```

If you don't give a category, your Actual **rules** can still assign one automatically (when `APPLY_RULES=true`). If nothing matches, the confirmation offers a **Set category** button for expenses.
Use `|` to add a note to any expense or income without changing its payee. The confirmation shows the note, and Actual stores it along with the bot attribution.

Each message is stored with a unique `imported_id`, so Telegram re-deliveries never create duplicates.

### Transfers between accounts

Use a transfer when you move money between your own accounts (checking → savings, checking → investments...). Actual records it as two linked transactions, one on each account, so it isn't counted as an expense or as income.

Two equivalent ways to send one:

```
200 @checking > @savings            plain message, use  >  or  ->  between the accounts
/transfer 200 @checking @savings    command, no ">" needed
```

| Form | Meaning |
| --- | --- |
| `200 @checking > @savings` | From `checking` to `savings`. |
| `200 > @savings` | From your **active account** (see `/accounts`) to `savings`. |
| `/transfer 200 @savings` | Same as above. |
| `/transfer 200 @checking @savings` | First `@` is the source, second is the destination. |
| `R$ 1500,50 @conta_corrente > @nubank_conta ontem` | Amounts, dates and underscore tags work like in normal transactions. |
| `500 @checking > @savings aluguel #reserva` | Extra words become a note on the transaction; `#category` is optional. |
| `500 @checking > @savings | aporte de emergencia` | Text after `|` becomes a note; useful when the note contains words that look like category, account, or date tokens. |

Rules and behaviour:

- Both accounts must be open accounts that exist in Actual (`/accounts` shows their `@tags`). A source equal to the destination is rejected.
- Moving money **from an on-budget to an off-budget account** (for example checking → investments) takes money out of your budget, so Actual wants a category for it. The confirmation then shows `Category: none` and a **🏷 Set category** button. Other transfers don't need one.
- **↩️ Undo** and `/undo` delete **both** sides of the transfer, so balances go back to what they were.
- Sending the same Telegram message twice never creates two transfers.
- A leading `+` is ignored in transfers: the direction is always source → destination.

Example confirmation:

```
🔁 Transfer R$ 200,00
From: Checking
To: Nubank Conta
Date: 2026-10-09
```

### Confirmation message and buttons

After adding a transaction or transfer the bot replies with the details and these buttons:

| Button | When shown | What it does |
| --- | --- | --- |
| **↩️ Undo** | Always | Deletes that transaction (both sides for a transfer). |
| **🏷 Set category** | Expenses with no category, and transfers from an on-budget to an off-budget account | Shows a list of categories to tap; the transaction is updated and the message edited. |

### `/accounts` and the active account

`/accounts` shows something like:

```
Accounts

✅ Checking
     R$ 1.250,00 · @Checking
▫️ Nubank Conta
     R$ 340,50 · @Nubank_Conta
▫️ Investments (off budget)
     R$ 12.000,00 · @Investments

Current account for new transactions: Checking
```

| Button | What it does |
| --- | --- |
| One button per account | Makes that account the **active account**. Messages without `@account` go there, and it's the source of transfers without `@from`. Saved in `data/state.json`, so it survives restarts. |
| **↺ Use default** | Clears the active account; new transactions go to `DEFAULT_ACCOUNT` from `.env` again. |

The ✅ marks the account that will receive your next transaction. The `@tag` shown is exactly what you can type for a one-off override.

### Error messages you may see

| Message | Meaning |
| --- | --- |
| `I didn't understand. Try 25.90 padaria or /help` | The message doesn't start with an amount. |
| `Usage: 200 @from > @to or /transfer 200 @from @to ...` | A transfer without a destination account. |
| `Account "x" not found (send /accounts)` | No open account matches that name. |
| `Source and destination accounts are the same` | A transfer from an account to itself. |
| `Category "x" not found (send /categories)` | No visible category matches that name. |
| `That message was already imported (duplicate ignored).` | Same Telegram message was received twice. |
| `Nothing to undo.` | `/undo` with no transaction added since the bot started. |

`/undo` only remembers the last transaction since the bot last started; the **↩️ Undo** button on a confirmation message keeps working after restarts.

---

## Setup

### 1. Create the bot
1. In Telegram, open **@BotFather** → `/newbot` → pick a name → copy the **token**.
2. Use the bot in a private chat; no privacy-mode changes are needed.

### 2. Requirements on the Pi
- 64-bit Raspberry Pi OS, Pi 3/4/5, ≥1 GB RAM
- Node.js 20.6+ (22 LTS recommended):
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs build-essential python3
  ```

### 3. Install
```bash
cd ~/actual-telegram-bot
npm install
cp .env.example .env && chmod 600 .env && nano .env
npm test
```

### 4. Configuration (`.env`)

| Variable | Required | Description |
| --- | --- | --- |
| `ACTUAL_SERVER_URL` | yes | URL of your Actual server, e.g. `http://localhost:5006` |
| `ACTUAL_PASSWORD` | yes | Server password |
| `ACTUAL_SYNC_ID` | yes | Actual → Settings → Show advanced settings → **Sync ID** |
| `ACTUAL_E2E_PASSWORD` | no | Only if the budget uses end-to-end encryption |
| `ACTUAL_DATA_DIR` | no | Local budget cache (default `./data/actual`) |
| `TELEGRAM_BOT_TOKEN` | yes | Token from @BotFather |
| `ALLOWED_USER_IDS` | yes | Comma-separated numeric Telegram user IDs allowed to use the bot |
| `DEFAULT_ACCOUNT` | no | Account used when no `@account` and no active account is set |
| `APPLY_RULES` | no | `true` (default): run Actual rules like a bank import. `false`: insert raw transactions |
| `CURRENCY` / `LOCALE` | no | Display format of amounts (default `BRL` / `pt-BR`) |

**Finding your Telegram ID:** leave `ALLOWED_USER_IDS` empty, run `npm start`, send `/id` to your bot, then put the number in `ALLOWED_USER_IDS` and restart.

### 5. Run
```bash
npm start
```
Send `10 teste` to your bot, check that it appears in Actual, then press **↩️ Undo**.

### 6. Run as a service
```bash
sudo cp actual-telegram-bot.service /etc/systemd/system/
# edit User= and WorkingDirectory= if you're not user "pi"
sudo systemctl daemon-reload
sudo systemctl enable --now actual-telegram-bot
journalctl -u actual-telegram-bot -f
```

---

## Notes
- **Long polling**: the bot asks Telegram for updates, so no public URL or port forwarding is needed.
- **Rules**: with `APPLY_RULES=true` transactions go through Actual's import pipeline, so your payee → category rules run automatically.
- **Duplicates**: each Telegram message id is stored as `imported_id`, so a message is never added twice.
- **Privacy**: regular bot chats are not end-to-end encrypted; messages pass through Telegram's servers.
- **State**: `data/state.json` stores each user's active account; `data/actual/` is the local budget cache. Both are git-ignored.
