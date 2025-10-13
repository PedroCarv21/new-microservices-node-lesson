FROM node:20-alpine
WORKDIR /app

# ADICIONE ESTA LINHA: Instala o curl para o healthcheck
RUN apk add --no-cache curl

COPY services/users-service/package.json ./package.json
RUN npm install --only=production

COPY services/users-service/src ./src

COPY common ./common

ENV PORT=3001
EXPOSE 3001
CMD ["npm","start"]
