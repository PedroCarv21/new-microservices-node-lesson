FROM node:20
WORKDIR /app

# Instala o curl para futuros healthchecks
RUN apt-get update && apt-get install -y curl

COPY services/orders-service/package.json ./package.json
RUN npm install

COPY services/orders-service/src ./src
COPY common ./common
COPY services/orders-service/prisma ./prisma

# Gera o cliente Prisma
RUN npx prisma generate

# Cria as tabelas do banco de dados (lendo o schema)
RUN npx prisma db push

# Remove as devDependencies para economizar espaço
RUN npm prune --production

ENV PORT=3002
EXPOSE 3002
CMD ["npm","start"]
