# Dashboard Capital Upgrade (CAUP) — imagem de produção
# App Node/Express que serve o front e consulta a Ploomes. Sem etapa de build.
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# Instala só as dependências de produção (camada cacheada por package*.json)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Código da aplicação
COPY . .

# server.js usa process.env.PORT (default 3000). O Easypanel pode sobrescrever.
ENV PORT=3000
EXPOSE 3000

# Roda sem privilégios de root
USER node

CMD ["node", "server.js"]
