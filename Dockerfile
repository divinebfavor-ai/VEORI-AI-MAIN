FROM node:18-alpine
WORKDIR /app
COPY backend/package*.json ./backend/
RUN npm install --prefix backend --production
COPY backend/ ./backend/
EXPOSE 3001
CMD ["node", "backend/src/index.js"]
