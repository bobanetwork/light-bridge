#!/bin/sh
sleep 10
npm run create-local-eth
npm run create-local-bnb
npm run deploy-local-eth
npm run deploy-local-bnb
read -p "Done deploying subgraphs, waiting to not abort tests.."