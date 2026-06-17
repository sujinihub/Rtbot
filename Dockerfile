FROM node:22-bookworm-slim

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install Linux libraries required by Chrome for Testing + Xvfb for headful mode
RUN apt-get update && apt-get install -y \
    ca-certificates \
    unzip \
    xvfb \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libu2f-udev \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxkbcommon0 \
    libxrandr2 \
    libxrender1 \
    libxshmfence1 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Set environment variables
ENV HEADLESS=true
ENV NODE_ENV=production
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV CHROME_USER_DATA_DIR=/data/.retweet-bot-chrome-profile
ENV CHROME_PROFILE_SEED_DIR=/app/profile-seed
ENV DISPLAY=:99

# Create app directory
WORKDIR /app

# Copy package files first so dependency installs stay cached
COPY package*.json .puppeteerrc.cjs ./
RUN npm install --no-fund --no-audit
RUN npx puppeteer browsers install chrome

# Copy the rest of the application code
COPY . .

# Prepare persistent and seedable Chrome profile directories
RUN mkdir -p /data /app/profile-seed

# Startup script seeds the persistent profile on first boot, then launches the app
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Expose port (optional health check)
EXPOSE 3000

# Seed profile if needed, start Xvfb, then run the bot
CMD ["/usr/local/bin/docker-entrypoint.sh"]
