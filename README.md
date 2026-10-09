# Actual Budget × Telegram bot

Send a Telegram message, get a transaction in Actual Budget.

```
25.90 padaria                      → expense, payee "padaria", default account
12,50 uber #transporte @nubank     → explicit category and account
+3000 salário                      → income
80 mercado ontem                   → date: hoje, ontem, dd/mm, dd/mm/aaaa
/accounts  /categories  /balance [account]  /undo  /id  /help
```
Each confirmation has **Undo** and (when no category was assigned) **Set category** buttons.

Actual only ships a Node.js client (no HTTP API), so the bot is Node.js too.

## 1. Create the bot
1. In Telegram, open **@BotFather** → `/newbot` → pick a name → copy the **token**.
2. (Optional) `/setprivacy` isn't needed; you'll use the bot in a private chat.

## 2. Requirements on the Pi
- 64-bit Raspberry Pi OS, Pi 3/4/5, ≥1 GB RAM
- Node.js 20.6+ (22 LTS recommended):
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs build-essential python3
  ```

## 3. Install
```bash
cd ~/actual-telegram-bot
npm install
cp .env.example .env && chmod 600 .env && nano .env
npm test
```
Fill in `.env`: server URL/password, **Sync ID** (Actual → Settings → Show advanced settings),
`TELEGRAM_BOT_TOKEN`, and `DEFAULT_ACCOUNT`.

**Finding your Telegram ID:** leave `ALLOWED_USER_IDS` empty, run `npm start`, send `/id` to your bot,
then put the number in `ALLOWED_USER_IDS` and restart. Only listed IDs can use the bot
(everyone else is ignored; only `/id` answers).

## 4. Run
```bash
npm start
```
Send `10 teste` to your bot, check that it appears in Actual, then `/undo`.

## 5. Run as a service
```bash
sudo cp actual-telegram-bot.service /etc/systemd/system/
# edit User= and WorkingDirectory= if you're not user "pi"
sudo systemctl daemon-reload
sudo systemctl enable --now actual-telegram-bot
journalctl -u actual-telegram-bot -f
```

## Notes
- **Long polling**: the bot asks Telegram for updates, so no public URL or port forwarding is needed.
- **Rules**: with `APPLY_RULES=true` transactions go through Actual's import pipeline, so your
  payee → category rules run automatically. `false` inserts raw transactions.
- **Duplicates**: each Telegram message id is stored as `imported_id`, so a message is never added twice.
- **Privacy**: regular bot chats are not end-to-end encrypted; messages pass through Telegram's servers.
- **Currency**: set `CURRENCY` / `LOCALE` in `.env` (default BRL / pt-BR).
