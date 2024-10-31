FROM node:16-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install
RUN apk --no-cache add curl
RUN npm install @grpc/grpc-js @grpc/proto-loader opossum axios wscat http-proxy-middleware

COPY . .

EXPOSE 3000

CMD ["node", "app.js"]
