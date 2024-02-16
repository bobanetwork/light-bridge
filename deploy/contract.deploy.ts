import {BigNumber, Contract, ethers, Wallet} from 'ethers'
import fs from 'fs'
import LightBridgeJson from "../artifacts/contracts/LightBridge.sol/LightBridge.json";
import Lib_ResolvedDelegateProxy
    from "../artifacts/contracts/Lib_ResolvedDelegateProxy.sol/Lib_ResolvedDelegateProxy.json"

let Proxy__LightBridge: Contract
let LightBridge: Contract

const file = {
    log: (network: string, text: string) => {
        const fileName = `./lightbridge_deploy_logs/lightbridge-${network}.txt`
        console.log(`${network}: ${text}`)

        if (fs.existsSync(fileName)) {
            fs.appendFileSync(fileName, text + '\n')
        } else {
            fs.writeFileSync(fileName, text + '\n')
        }
    },
}

enum ChainIds {
    ETH_MAINNET = 1,
    BOBA_ETH_MAINNET = 288,
    BOBA_BNB_MAINNET = 56288,
    BNB_MAINNET = 56,
    OPTIMISM_MAINNET = 10,
    ARBITRUM_MAINNET = 42161,

    SEPOLIA_TESTNET = 11155111,
    GOERLI_TESTNET = 5,
    BOBA_SEPOLIA_TESTNET = 28882,
    BOBA_GOERLI_TESTNET = 2888,
    BOBA_BNB_TESTNET = 9728,
    BNB_TESTNET = 97,
    OPTIMISM_TESTNET = 420,
    ARBITRUM_TESTNET = 421613,

    /*LOCAL = 31337,
    LOCAL_2 = 31338,
    LOCAL_BNB = 99,
    LOCAL_BNB_2 = 100,*/
}

const hre = require("hardhat")
const prompt = require("prompt-sync")()

async function main() {

    console.log(`'Deploying Light bridge contract...`)

    const provider = hre.ethers.provider
    const network = hre.network

    console.log(`Network name=${network?.name}`)
    let fileName

    const deployer = new Wallet(network.config.accounts[0], provider)
    const currChainId = (await provider.getNetwork()).chainId as ChainIds // (await hre.getChainId()) as any as ChainIds
    console.log(`Network chain id=${currChainId}, ${network?.name}`)

    const Factory__LightBridge = new ethers.ContractFactory(
        LightBridgeJson.abi,
        LightBridgeJson.bytecode,
        deployer
    )
    const Factory__ProxyLightBridge = new ethers.ContractFactory(
        Lib_ResolvedDelegateProxy.abi,
        Lib_ResolvedDelegateProxy.bytecode,
        deployer
    )

    //const gasPrice = BigNumber.from("110000000")
    let gasLimit = prompt("Custom gas limit? [number/N]")
    if (isNaN(gasLimit?.toLowerCase())) {
        gasLimit = null;
    } else {
        gasLimit = parseInt(gasLimit)
    }

    /*const deployData = Factory__LightBridge.interface.encodeDeploy()
    const estimatedGas = await provider.estimateGas({ data: deployData })
    console.log("ESTIMATED GAS: ", estimatedGas, deployData)*/

    const redeploy = prompt("Want to redeploy? [Y/n]")?.toLowerCase() === "y"
    if (redeploy) {
        LightBridge = await Factory__LightBridge.deploy({gasLimit})
        let res = await LightBridge.deployTransaction.wait()
        console.log(`Deployed light bridge: `, res)

        console.log(`LightBridge for ${currChainId} deployed to: ${LightBridge.address}`)
        Proxy__LightBridge = await Factory__ProxyLightBridge.deploy(LightBridge.address, {gasLimit})
        res = await Proxy__LightBridge.deployTransaction.wait()

        fileName = `${Proxy__LightBridge.address}-${currChainId}`
        file.log(fileName, `LightBridge deployed to: ${LightBridge.address}`)
        file.log(
            fileName,
            `Proxy__LightBridge deployed to: ${Proxy__LightBridge.address}`
        )
    } else {
        const previousDeploymentAddress = prompt("What's the previous deployment address to be used?")

        if (!previousDeploymentAddress || !ethers.utils.isAddress(previousDeploymentAddress)) {
            throw new Error("Trying to use previous address, but cannot find previous deployment - not configured address: " + previousDeploymentAddress)
        }
        fileName = `${previousDeploymentAddress}-${currChainId}`
        file.log(fileName, "Using previous deployment of LightBridge contract on " + previousDeploymentAddress)
        Proxy__LightBridge = new ethers.Contract(
            Proxy__LightBridge.address,
            Factory__LightBridge.interface,
            deployer
        )
    }

    // change abi for proxy
    console.log("Changing abi from Proxy to LightBridge as calls are delegated..")
    Proxy__LightBridge = new ethers.Contract(
        Proxy__LightBridge.address,
        Factory__LightBridge.interface,
        deployer
    )

    const DEFAULT_ROUTING_CONF: {
        "ETH": {
            minAmount: BigNumber,
            maxAmount: BigNumber,
            maxDailyAmount: BigNumber,
        }, "BOBA": {
            minAmount: BigNumber,
            maxAmount: BigNumber,
            maxDailyAmount: BigNumber,
        }
    } = {
        "ETH": {
            minAmount: ethers.utils.parseEther('0.01'),
            maxAmount: ethers.utils.parseEther('2'),
            maxDailyAmount: ethers.utils.parseEther('6'),
        },
        "BOBA": {
            minAmount: ethers.utils.parseEther('20'),
            maxAmount: ethers.utils.parseEther('20000'),
            maxDailyAmount: ethers.utils.parseEther('40000'),
        },
    }

    // Initialize the Proxy__LightBridge contract
    if (redeploy) {
        let res = await Proxy__LightBridge.initialize({gasLimit})
        file.log(fileName, `Initialized proxy: ${await res.wait()}`)
        res = await LightBridge.initialize()
        file.log(fileName, `LightBridge initialized: ${await res.wait()}`)
    } else {
        try {
            const disburser = await LightBridge.disburser()
            if (!disburser || disburser === ethers.constants.AddressZero) {
                // not initialized
                let res = await Proxy__LightBridge.initialize({gasLimit})
                file.log(fileName, `Initialized proxy: ${await res.wait()}`)
                res = await LightBridge.initialize()
                file.log(fileName, `Light bridge initialized: ${await res.wait()}`)
            } else {
                file.log(fileName, `Not initializing contract again as already done.`)
            }
        } catch (err) {
            file.log(fileName, `Could not initialized not initialized contracts for already deployed contracts: ${JSON.stringify(err)}`)
        }
    }

    type Route = {
        fromChainId: ChainIds,
        toChainId: ChainIds,
        fromTokenAddr: string,
        minAmount: BigNumber,
        maxAmount: BigNumber,
        maxDailyAmount: BigNumber,
    }
    const desiredRoutes: Route[] = [
        //#region testnets
        // ETH: ETH Sepolia <-> ETH BOBA Sepolia
        {
            fromChainId: ChainIds.SEPOLIA_TESTNET,
            toChainId: ChainIds.BOBA_SEPOLIA_TESTNET,
            fromTokenAddr: '0x0000000000000000000000000000000000000000', // eth
            minAmount: DEFAULT_ROUTING_CONF.ETH.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.ETH.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.ETH.maxDailyAmount,
        },
        {
            fromChainId: ChainIds.BOBA_SEPOLIA_TESTNET,
            toChainId: ChainIds.SEPOLIA_TESTNET,
            fromTokenAddr: '0x0000000000000000000000000000000000000000', // eth
            minAmount: DEFAULT_ROUTING_CONF.ETH.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.ETH.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.ETH.maxDailyAmount,
        },
        // BOBA: ETH Sepolia <-> ETH Boba Sepolia
        {
            fromChainId: ChainIds.SEPOLIA_TESTNET,
            toChainId: ChainIds.BOBA_SEPOLIA_TESTNET,
            fromTokenAddr: '0x33faF65b3DfcC6A1FccaD4531D9ce518F0FDc896', // boba
            minAmount: DEFAULT_ROUTING_CONF.BOBA.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.BOBA.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.BOBA.maxDailyAmount,
        },
        {
            fromChainId: ChainIds.BOBA_SEPOLIA_TESTNET,
            toChainId: ChainIds.SEPOLIA_TESTNET,
            fromTokenAddr: '0x4200000000000000000000000000000000000023', // boba
            minAmount: DEFAULT_ROUTING_CONF.BOBA.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.BOBA.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.BOBA.maxDailyAmount,
        },

        // ETH: ETH <-> ETH BOBA
        {
            fromChainId: ChainIds.GOERLI_TESTNET,
            toChainId: ChainIds.BOBA_GOERLI_TESTNET,
            fromTokenAddr: '0x0000000000000000000000000000000000000000', // eth
            minAmount: DEFAULT_ROUTING_CONF.ETH.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.ETH.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.ETH.maxDailyAmount,
        },
        {
            fromChainId: ChainIds.BOBA_GOERLI_TESTNET,
            toChainId: ChainIds.GOERLI_TESTNET,
            fromTokenAddr: '0x0000000000000000000000000000000000000000', // eth
            minAmount: DEFAULT_ROUTING_CONF.ETH.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.ETH.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.ETH.maxDailyAmount,
        },
        // ETH: BNB <-> BNB BOBA
        {
            fromChainId: ChainIds.BNB_TESTNET,
            toChainId: ChainIds.BOBA_BNB_TESTNET,
            fromTokenAddr: '0xd66c6B4F0be8CE5b39D52E0Fd1344c389929B378', // eth
            minAmount: DEFAULT_ROUTING_CONF.ETH.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.ETH.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.ETH.maxDailyAmount,
        },
        {
            fromChainId: ChainIds.BOBA_BNB_TESTNET,
            toChainId: ChainIds.BNB_TESTNET,
            fromTokenAddr: '0xc614A66f82e71758Fa7735C91dAD1088c8362f15', // eth
            minAmount: DEFAULT_ROUTING_CONF.ETH.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.ETH.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.ETH.maxDailyAmount,
        },
        // BOBA: ETH <-> ETH Boba
        {
            fromChainId: ChainIds.GOERLI_TESTNET,
            toChainId: ChainIds.BOBA_GOERLI_TESTNET,
            fromTokenAddr: '0xeCCD355862591CBB4bB7E7dD55072070ee3d0fC1', // boba
            minAmount: DEFAULT_ROUTING_CONF.BOBA.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.BOBA.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.BOBA.maxDailyAmount,
        },
        {
            fromChainId: ChainIds.BOBA_GOERLI_TESTNET,
            toChainId: ChainIds.GOERLI_TESTNET,
            fromTokenAddr: '0x4200000000000000000000000000000000000023', // boba
            minAmount: DEFAULT_ROUTING_CONF.BOBA.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.BOBA.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.BOBA.maxDailyAmount,
        },
        // BOBA: ETH <-> BNB
        {
            fromChainId: ChainIds.GOERLI_TESTNET,
            toChainId: ChainIds.BNB_TESTNET,
            fromTokenAddr: '0xeCCD355862591CBB4bB7E7dD55072070ee3d0fC1', // boba
            minAmount: DEFAULT_ROUTING_CONF.BOBA.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.BOBA.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.BOBA.maxDailyAmount,
        },
        {
            fromChainId: ChainIds.BNB_TESTNET,
            toChainId: ChainIds.GOERLI_TESTNET,
            fromTokenAddr: '0x875cD11fDf085e0E11B0EE6b814b6d0b38fA554C', // boba
            minAmount: DEFAULT_ROUTING_CONF.BOBA.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.BOBA.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.BOBA.maxDailyAmount,
        },
        // BOBA: BNB <-> Boba BNB
        {
            fromChainId: ChainIds.BNB_TESTNET,
            toChainId: ChainIds.BOBA_BNB_TESTNET,
            fromTokenAddr: '0x875cD11fDf085e0E11B0EE6b814b6d0b38fA554C', // boba
            minAmount: DEFAULT_ROUTING_CONF.BOBA.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.BOBA.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.BOBA.maxDailyAmount,
        },
        {
            fromChainId: ChainIds.BOBA_BNB_TESTNET,
            toChainId: ChainIds.BNB_TESTNET,
            fromTokenAddr: '0x0000000000000000000000000000000000000000', // boba
            minAmount: DEFAULT_ROUTING_CONF.BOBA.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.BOBA.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.BOBA.maxDailyAmount,
        },
        // BOBA: ETH BOBA <-> Boba BNB
        {
            fromChainId: ChainIds.BOBA_GOERLI_TESTNET,
            toChainId: ChainIds.BOBA_BNB_TESTNET,
            fromTokenAddr: '0x4200000000000000000000000000000000000023', // boba
            minAmount: DEFAULT_ROUTING_CONF.BOBA.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.BOBA.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.BOBA.maxDailyAmount,
        },
        {
            fromChainId: ChainIds.BOBA_BNB_TESTNET,
            toChainId: ChainIds.BOBA_GOERLI_TESTNET,
            fromTokenAddr: '0x0000000000000000000000000000000000000000', // boba
            minAmount: DEFAULT_ROUTING_CONF.BOBA.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.BOBA.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.BOBA.maxDailyAmount,
        },
        // BOBA: ETH BOBA <-> BNB
        {
            fromChainId: ChainIds.BOBA_GOERLI_TESTNET,
            toChainId: ChainIds.BNB_TESTNET,
            fromTokenAddr: '0x4200000000000000000000000000000000000023', // boba
            minAmount: DEFAULT_ROUTING_CONF.BOBA.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.BOBA.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.BOBA.maxDailyAmount,
        },
        {
            fromChainId: ChainIds.BNB_TESTNET,
            toChainId: ChainIds.BOBA_GOERLI_TESTNET,
            fromTokenAddr: '0x875cD11fDf085e0E11B0EE6b814b6d0b38fA554C', // boba
            minAmount: DEFAULT_ROUTING_CONF.BOBA.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.BOBA.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.BOBA.maxDailyAmount,
        },
        // limitedNetworks (ARB/OP)
        {
            // only supporting onboarding
            fromChainId: ChainIds.OPTIMISM_TESTNET,
            toChainId: ChainIds.BOBA_GOERLI_TESTNET,
            fromTokenAddr: '0x0000000000000000000000000000000000000000', // eth
            minAmount: DEFAULT_ROUTING_CONF.ETH.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.ETH.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.ETH.maxDailyAmount,
        },
        {
            // only supporting onboarding
            fromChainId: ChainIds.ARBITRUM_TESTNET,
            toChainId: ChainIds.BOBA_GOERLI_TESTNET,
            fromTokenAddr: '0x0000000000000000000000000000000000000000', // eth
            minAmount: DEFAULT_ROUTING_CONF.ETH.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.ETH.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.ETH.maxDailyAmount,
        },
        // NOTE: Boba token not supported for OP/ARB, as not deployed there (thus Boba BNB where Boba is native is not supported & no WETH available)
        //#endregion
        //#region mainnets
        // ETH: ETH <-> ETH BOBA
        {
            fromChainId: ChainIds.ETH_MAINNET,
            toChainId: ChainIds.BOBA_ETH_MAINNET,
            fromTokenAddr: '0x0000000000000000000000000000000000000000', // eth
            minAmount: DEFAULT_ROUTING_CONF.ETH.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.ETH.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.ETH.maxDailyAmount,
        },
        {
            fromChainId: ChainIds.BOBA_ETH_MAINNET,
            toChainId: ChainIds.ETH_MAINNET,
            fromTokenAddr: '0x0000000000000000000000000000000000000000', // eth
            minAmount: DEFAULT_ROUTING_CONF.ETH.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.ETH.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.ETH.maxDailyAmount,
        },
        // ETH: BNB <-> BNB BOBA
        {
            fromChainId: ChainIds.BNB_MAINNET,
            toChainId: ChainIds.BOBA_BNB_MAINNET,
            fromTokenAddr: '0x0000000000000000000000000000000000000000', // bnb
            minAmount: DEFAULT_ROUTING_CONF.ETH.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.ETH.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.ETH.maxDailyAmount,
        },
        {
            fromChainId: ChainIds.BOBA_BNB_MAINNET,
            toChainId: ChainIds.BNB_MAINNET,
            fromTokenAddr: '0x4200000000000000000000000000000000000023', // bnb
            minAmount: DEFAULT_ROUTING_CONF.ETH.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.ETH.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.ETH.maxDailyAmount,
        },
        // BOBA: ETH <-> ETH Boba
        {
            fromChainId: ChainIds.ETH_MAINNET,
            toChainId: ChainIds.BOBA_ETH_MAINNET,
            fromTokenAddr: '0x42bbfa2e77757c645eeaad1655e0911a7553efbc', // boba
            minAmount: DEFAULT_ROUTING_CONF.BOBA.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.BOBA.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.BOBA.maxDailyAmount,
        },
        {
            fromChainId: ChainIds.BOBA_ETH_MAINNET,
            toChainId: ChainIds.ETH_MAINNET,
            fromTokenAddr: '0xa18bF3994C0Cc6E3b63ac420308E5383f53120D7', // boba
            minAmount: DEFAULT_ROUTING_CONF.BOBA.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.BOBA.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.BOBA.maxDailyAmount,
        },
        // BOBA: BNB <-> Boba BNB
        {
            fromChainId: ChainIds.BNB_MAINNET,
            toChainId: ChainIds.BOBA_BNB_MAINNET,
            fromTokenAddr: '0xE0DB679377A0F5Ae2BaE485DE475c9e1d8A4607D', // boba
            minAmount: DEFAULT_ROUTING_CONF.BOBA.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.BOBA.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.BOBA.maxDailyAmount,
        },
        {
            fromChainId: ChainIds.BOBA_BNB_MAINNET,
            toChainId: ChainIds.BNB_MAINNET,
            fromTokenAddr: '0x0000000000000000000000000000000000000000', // boba
            minAmount: DEFAULT_ROUTING_CONF.BOBA.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.BOBA.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.BOBA.maxDailyAmount,
        },
        // BOBA: ETH BOBA <-> Boba BNB
        {
            fromChainId: ChainIds.BOBA_ETH_MAINNET,
            toChainId: ChainIds.BOBA_BNB_MAINNET,
            fromTokenAddr: '0xa18bF3994C0Cc6E3b63ac420308E5383f53120D7', // boba
            minAmount: DEFAULT_ROUTING_CONF.BOBA.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.BOBA.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.BOBA.maxDailyAmount,
        },
        {
            fromChainId: ChainIds.BOBA_BNB_MAINNET,
            toChainId: ChainIds.BOBA_ETH_MAINNET,
            fromTokenAddr: '0x0000000000000000000000000000000000000000', // boba
            minAmount: DEFAULT_ROUTING_CONF.BOBA.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.BOBA.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.BOBA.maxDailyAmount,
        },
        // BOBA: ETH BOBA <-> BNB
        {
            fromChainId: ChainIds.BOBA_ETH_MAINNET,
            toChainId: ChainIds.BNB_MAINNET,
            fromTokenAddr: '0xa18bF3994C0Cc6E3b63ac420308E5383f53120D7', // boba
            minAmount: DEFAULT_ROUTING_CONF.BOBA.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.BOBA.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.BOBA.maxDailyAmount,
        },
        {
            fromChainId: ChainIds.BNB_MAINNET,
            toChainId: ChainIds.BOBA_ETH_MAINNET,
            fromTokenAddr: '0xE0DB679377A0F5Ae2BaE485DE475c9e1d8A4607D', // boba
            minAmount: DEFAULT_ROUTING_CONF.BOBA.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.BOBA.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.BOBA.maxDailyAmount,
        },
        // limitedNetworks (ARB/OP)
        {
            // only supporting onboarding
            fromChainId: ChainIds.OPTIMISM_MAINNET,
            toChainId: ChainIds.BOBA_ETH_MAINNET,
            fromTokenAddr: '0x0000000000000000000000000000000000000000', // eth
            minAmount: DEFAULT_ROUTING_CONF.ETH.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.ETH.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.ETH.maxDailyAmount,
        },
        {
            // only supporting onboarding
            fromChainId: ChainIds.ARBITRUM_MAINNET,
            toChainId: ChainIds.BOBA_ETH_MAINNET,
            fromTokenAddr: '0x0000000000000000000000000000000000000000', // eth
            minAmount: DEFAULT_ROUTING_CONF.ETH.minAmount,
            maxAmount: DEFAULT_ROUTING_CONF.ETH.maxAmount,
            maxDailyAmount: DEFAULT_ROUTING_CONF.ETH.maxDailyAmount,
        },
        // NOTE: Boba token not supported for OP/ARB, as not deployed there (thus Boba BNB where Boba is native is not supported & no WETH available)
        //#endregion
    ]

    const addRoute = async ({toChainId, fromTokenAddr, minAmount, maxAmount, maxDailyAmount}: Route) => {
        try {
            // avoid wasting gas if already supported
            await Proxy__LightBridge.estimateGas.addSupportedToken(
                fromTokenAddr,
                toChainId,
                minAmount,
                maxAmount,
                maxDailyAmount,
                {gasLimit}
            )
            const routeRes = await Proxy__LightBridge.addSupportedToken(
                fromTokenAddr,
                toChainId,
                minAmount,
                maxAmount,
                maxDailyAmount,
                {gasLimit}
            )
            file.log(
                fileName,
                `Added route for ${toChainId} chain, and token: ${fromTokenAddr}, receipt: ${await routeRes.wait()}`
            )
        } catch (err) {
            if (JSON.stringify(err).includes('Already supported')) {
                file.log(fileName, `Route for ${toChainId} chain, and token: ${fromTokenAddr} not added again, as already supported.`)
            } else {
                throw new err;
            }
        }
    }

    for (const route of desiredRoutes) {
        if (currChainId === route.fromChainId) {
            await addRoute(route)
        }
    }

    file.log(fileName, 'Network iteration done')
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

