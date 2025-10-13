FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache curl
COPY gateway/package.json ./package.json
RUN npm install --only=production
COPY gateway/src ./src

ENV PORT=3000
EXPOSE 3000
CMD ["npm","start"]
