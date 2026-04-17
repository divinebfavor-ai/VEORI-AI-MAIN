FROM node:18-alpine

WORKDIR /app

# Copy backend package files first (layer cache)
COPY backend/package*.json ./

# Install dependencies
RUN npm install --production

# Copy all backend source
COPY backend/ .

EXPOSE 3001

CMD ["node", "src/index.js"]
