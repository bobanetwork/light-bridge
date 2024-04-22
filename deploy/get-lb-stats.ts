import { BigNumber, Contract, ethers, providers, utils, Wallet } from 'ethers'
import LightBridgeJson from "../artifacts/contracts/LightBridge.sol/LightBridge.json";
import { LightBridgeAssetReceivedEvent, lightBridgeGraphQLService } from '@bobanetwork/graphql-utils'
import { parseEther } from 'ethers/lib/utils'

const hre = require("hardhat")
const prompt = require("prompt-sync")()

interface IChainStats {
    fromChainId: string
    toChainId: string
    amountNativeBridged: BigNumber
    amountBobaBridged: BigNumber
}

async function main() {



// filter out local chainIds
    const supportedChainIds = Object.keys(lightBridgeGraphQLService.GRAPHQL_ENDPOINTS).filter(chainId => chainId !== '31337' && chainId !== '31338')

    let assetReceivedEvents: LightBridgeAssetReceivedEvent[] = []
    for (const chainId of supportedChainIds) {
        assetReceivedEvents = [...assetReceivedEvents, ...(await lightBridgeGraphQLService.queryAssetReceivedEvent(chainId))]
    }

    const chainStats: IChainStats[] = assetReceivedEvents.reduce((accumulator: IChainStats[], event: LightBridgeAssetReceivedEvent) => {
        const existingChainStat = accumulator.find(stat => stat.fromChainId === event.sourceChainId && stat.toChainId === event.toChainId);

        const amount = BigNumber.from(event.amount?.toString() ?? "0");
        const isNativeAsset = event.token === ethers.constants.AddressZero
        if (existingChainStat) {
            if (isNativeAsset) {
                existingChainStat.amountNativeBridged = existingChainStat.amountNativeBridged.add(amount);
            } else {
                existingChainStat.amountBobaBridged = existingChainStat.amountBobaBridged.add(amount);
            }
        } else {
            accumulator.push({
                fromChainId: event.sourceChainId,
                toChainId: event.toChainId,
                amountNativeBridged: isNativeAsset ? amount : BigNumber.from("0"),
                amountBobaBridged: isNativeAsset ? BigNumber.from("0") : amount,
            });
        }

        return accumulator;
    }, []);

    chainStats.forEach((stat) => {
        console.log(`ChainId ${stat.fromChainId} -> ${stat.toChainId}: ${ethers.utils.formatEther(stat.amountNativeBridged.toString())} origin native, ${ethers.utils.formatEther(stat.amountBobaBridged.toString())} origin secondary token`)
    })
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

