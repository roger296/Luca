FROM node:20-alpine

WORKDIR /app

# Install dependencies first (cached layer)
COPY package.json package-lock.json* ./
RUN npm install

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Expose the API port
EXPOSE 3000

# Run migrations and start the server
CMD ["sh", "-c", "npm run migrate && npm run seed && node dist/server.js"]
