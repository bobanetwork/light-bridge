#!/bin/sh
sleep 10
npm run create-local-eth
npm run deploy-local-eth
# just keep running forever to avoid exiting the container (to not break Github actions that stop on container exit)
while :; do sleep 2073600; done