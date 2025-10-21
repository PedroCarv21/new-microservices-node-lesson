FROM node:20
WORKDIR /app

RUN apt-get update && apt-get install -y curl

# Copia o package.json
COPY services/users-service/package.json ./package.json

# Instala TODAS as dependências (incluindo devDependencies como 'prisma')
RUN npm install

# Copia o restante dos arquivos do serviço
COPY services/users-service/src ./src
COPY common ./common
# ADICIONE: Copia o schema do Prisma
COPY services/users-service/prisma ./prisma

# ADICIONE: Gera o cliente Prisma
RUN npx prisma generate

# Este comando irá ler o schema e criar as tabelas.
RUN npx prisma db push

# (Opcional) Remove as devDependencies para economizar espaço
RUN npm prune --production

ENV PORT=3001
EXPOSE 3001
CMD ["npm","start"]