FROM node:20
COPY package.json .
RUN npm i
COPY . .
CMD ["npm", "run", "start"]

