import {BigNumber, Contract, ethers, providers, Wallet} from 'ethers'
import LightBridgeJson from "../artifacts/contracts/LightBridge.sol/LightBridge.json";

const hre = require("hardhat")
const prompt = require("prompt-sync")()

async function main() {

    console.log(`'Transfer rights to multi-sig (Light bridge contract), ..`)
    const provider = hre.ethers.provider
    const network = hre.network
    const chainId = (await provider.getNetwork()).chainId

    console.log(`Network name=${network?.name}`)
    console.log(`Network chain id=${chainId}`)
    if (!network?.config?.accounts || !network?.config?.accounts?.length) {
        console.log('No private key supplied, aborting.')
        return;
    }

    const deployer = new Wallet(network.config.accounts[0], provider)

    const ADDRESSES = {
        LIGHT_BRIDGE: '0x0dfFd3Efe9c3237Ad7bf94252296272c96237FF5',
        NEW_DISBURSER: '0x2d02ce7ef2f359bdcf86e44f66345660725e5cce',
        NEW_OWNER: '0x30687BDFA9CbEE46EBc7D0acA148971203C17ef8',
    }
    console.log("Network: ", chainId, network.name)
    console.log("Your addresses: ", JSON.stringify(ADDRESSES))
    const continuePrompt = prompt("Please confirm you have configured your addresses correctly, continue? [y/N] ")
    if (continuePrompt?.toLowerCase() !== 'y') {
        console.log('Aborting, since addresses not yet set.')
        return;
    }


    const Factory__LightBridge = new ethers.ContractFactory(
        LightBridgeJson.abi,
        LightBridgeJson.bytecode,
        deployer
    )

    // change abi for proxy
    console.log("Changing abi from Proxy to Teleportation as calls are delegated..")
    const Proxy__LightBridge = new ethers.Contract(
        ADDRESSES.LIGHT_BRIDGE,
        Factory__LightBridge.interface,
        deployer)

    const prevDisburserAddress = await Proxy__LightBridge.disburser();
    console.log(`Trying to transfer disburser from ${prevDisburserAddress} to address: ${ADDRESSES.NEW_DISBURSER}`)
    const confirmDisburserTransfer = prompt('Are you sure? [y/N]')
    if (confirmDisburserTransfer?.toLowerCase() !== 'y') {
        console.log('Aborting disburser transfer.')
    } else {
        const res = await Proxy__LightBridge.transferDisburser(ADDRESSES.NEW_DISBURSER);
        console.log(await res.wait())
        console.log('\nDisburser successfully transferred!')
    }

    const prevOwnerAddress = await Proxy__LightBridge.owner();
    console.log(`Trying to transfer owner from ${prevOwnerAddress} to address: ${ADDRESSES.NEW_OWNER}`)
    const confirmOwnerTransfer = prompt('Are you sure, this makes it impossible to change anything from your current wallet? [y/N]')
    if (confirmOwnerTransfer?.toLowerCase() !== 'y') {
        console.log('Aborting owner transfer.')
    } else {
        const res = await Proxy__LightBridge.transferOwnership(ADDRESSES.NEW_OWNER);
        console.log(await res.wait())
        console.log('\nOwner successfully transferred!')
    }

    console.log('Rights transfer done')
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

