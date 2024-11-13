FROM node:20
COPY package.json .
# RUN npm i
RUN npm i -g pnpm
COPY . .
RUN pnpm install
RUN pnpm run build
CMD ["pnpm", "run", "start:prod"]