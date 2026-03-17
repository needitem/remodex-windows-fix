FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY bin ./bin
COPY relay ./relay
COPY src ./src

EXPOSE 9000

CMD ["node", "./bin/remodex-relay.js"]
