# X Retweet Bot

A Telegram bot that logs into X/Twitter and retweets links sent to the bot or in a group.

## Features

- Local Chrome integration for bot evasion
- Docker support for deployment
- Persistent Chrome profile (saves login)
- Queue for retweets when bot is offline
- Anti-bot measures (puppeteer-real-browser)
- Turnstile/CAPTCHA solving

## Local Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file with your credentials (see `.env.example`)
3. Run the bot:
   ```bash
   npm start
   ```

## Docker Setup (Test Render Locally)

1. Install Docker Desktop (https://www.docker.com/products/docker-desktop/)
2. Make sure Docker Desktop is running
3. Build once:
   ```bash
   docker compose build
   ```
4. Start the app after the first build:
   ```bash
   docker compose up
   ```
5. Only rebuild when `Dockerfile` or dependencies change. Regular app code changes can usually reuse the cached image layers.

## Deployment to Render

1. Push this repo to GitHub
2. In Render, create a new **Web Service**
3. Connect your repo
4. Set environment to **Docker**
5. Add env vars:
   - `BOT_TOKEN` - Telegram bot token from @BotFather
   - `MONGODB_URI` - MongoDB connection string (use MongoDB Atlas for free)
6. Use a paid plan (Starter recommended for Chrome resources)
7. Deploy!

## Commands

- `/start` - Main menu
