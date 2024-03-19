FROM node:lts-alpine3.18
COPY package.json ./
RUN npm install
COPY . .
RUN npm run codegen && npm run build
RUN ["chmod", "+x", "./deploy.sh"]
ENTRYPOINT ["./deploy.sh"]
