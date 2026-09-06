FROM node:22-alpine

WORKDIR /app

COPY app/package.json app/package-lock.json ./

RUN npm ci --omit=dev

COPY app/ ./

ENV NODE_ENV=production

EXPOSE 8080

CMD ["npm", "start"]