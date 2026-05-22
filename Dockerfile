FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./backend/
RUN npm install --prefix backend --production
COPY backend/ ./backend/
# PORT is injected by Railway at runtime — do not hardcode
EXPOSE 8080
CMD ["node", "backend/src/index.js"]
