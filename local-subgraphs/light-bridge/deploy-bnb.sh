#!/bin/sh
sleep 10
npm run create-local-bnb
npm run deploy-local-bnb
# just keep running forever to avoid exiting the container (to not break Github actions that stop on container exit)
while :; do sleep 2073600; done