FROM node:16-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install
RUN apk --no-cache add curl
RUN npm install @grpc/grpc-js @grpc/proto-loader opossum axios wscat http-proxy-middleware uuid prom-client pg
RUN npm install ioredis
RUN npm install ws

COPY . .

EXPOSE 3000

CMD ["node", "app.js"]
