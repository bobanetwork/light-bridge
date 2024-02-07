FROM node
COPY package.json .
RUN npm i
COPY . .
CMD ["npm", "run", "start"]

