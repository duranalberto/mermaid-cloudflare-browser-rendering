FROM mcr.microsoft.com/devcontainers/typescript-node:20

# Install Chromium dependencies for Puppeteer
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y --no-install-recommends \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxshmfence1 \
    libxtst6 \
    fonts-liberation \
    libappindicator3-1 \
    lsb-release \
    xdg-utils \
    wget \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Pre-install wrangler globally for convenience
RUN npm install -g wrangler