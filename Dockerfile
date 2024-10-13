FROM node:20
COPY package.json .
RUN npm i -g pnpm
RUN pnpm install
COPY . .
CMD ["pnpm", "run", "start:prod"]

