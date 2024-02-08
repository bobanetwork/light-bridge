import {BigNumber, Contract, ethers, providers} from 'ethers'
import { getContractFactory } from '@bobanetwork/core_contracts'
import fs from 'fs'
import LightBridgeJson from "../artifacts/contracts/LightBridge.sol/LightBridge.json";
import Lib_ResolvedDelegateProxy from "../artifacts/contracts/Lib_ResolvedDelegateProxy.sol/Lib_ResolvedDelegateProxy.json"

let Proxy__LightBridge: Contract
let LightBridge: Contract

const file = {
  log: (network: string, text: string) => {
    const fileName = `./teleportation_deploy_logs/teleportation-${network}.txt`
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

  GOERLI_TESTNET = 5,
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

async function main() {

  const addressManager = getContractFactory('Lib_AddressManager')
      .connect((hre as any).deployConfig.deployer_l1)
      .attach(process.env.ADDRESS_MANAGER_ADDRESS) as any

  console.log(`'Deploying Teleportation contract...`)

  const l1Provider = new providers.JsonRpcProvider(process.env.L1_NODE_WEB3_URL)
  const l2Provider = new providers.JsonRpcProvider(process.env.L2_NODE_WEB3_URL)
  const l2Network = await l2Provider.getNetwork()
  const l1Network = await l1Provider.getNetwork()

  console.log(`Network name=${l2Network?.name} (L2), ${l1Network?.name} (L1)`)
  console.log(`Network chain id=${l2Network?.chainId} (L2), ${l1Network?.name} (L1)`)
  let fileName

  for (const {deployer, isL2} of [{deployer: (hre as any).deployConfig.deployer_l2, isL2: true}, {deployer: (hre as any).deployConfig.deployer_l1, isL2: false}]) {
    const currChainId = (isL2 ? l2Network.chainId : l1Network.chainId) as ChainIds // (await hre.getChainId()) as any as ChainIds

    // TODO: change back for avoiding errors, right now Goerli
    const previousDeploymentAddress = "0x..................."  // TODO: Adapt your address here

    const redeploy = !(ethers.utils.isAddress(previousDeploymentAddress) && !isL2) ?? true

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

    if (redeploy) {

      LightBridge = await Factory__LightBridge.deploy()
      let res = await LightBridge.deployTransaction.wait()
      console.log(`Deployed light bridge: `, res)

      console.log(`LightBridge for isL2 (${isL2}) deployed to: ${LightBridge.address}`)
      Proxy__LightBridge = await Factory__ProxyLightBridge.deploy(LightBridge.address)
      res = await Proxy__LightBridge.deployTransaction.wait()

      fileName = `${Proxy__LightBridge.address}-${currChainId}`
      file.log(fileName, `${isL2 ? 'L2' : 'L1'} LightBridge deployed to: ${LightBridge.address}`)
      file.log(
          fileName,
          `${isL2 ? 'L2' : 'L1'} Proxy__LightBridge deployed to: ${Proxy__LightBridge.address}`
      )
    } else {
      if (!previousDeploymentAddress || !ethers.utils.isAddress(previousDeploymentAddress)) {
        throw new Error("Trying to use previous address, but cannot find previous deployment - not configured address: "+previousDeploymentAddress)
      }
      fileName = `${previousDeploymentAddress}-${currChainId}`
      file.log(fileName, "Using previous deployment of Teleportation contract on " + previousDeploymentAddress + ", " + isL2)
      Proxy__LightBridge = new ethers.Contract(
          Proxy__LightBridge.address,
          Factory__LightBridge.interface,
          deployer
      )
    }

    // change abi for proxy
    console.log("Changing abi from Proxy to Teleportation as calls are delegated..")
    Proxy__LightBridge = new ethers.Contract(
        Proxy__LightBridge.address,
        Factory__LightBridge.interface,
        deployer
    )

    const defMinAmount = ethers.utils.parseEther('1')
    const defMaxAmount = ethers.utils.parseEther('100000')
    const defMaxDailyAmount = ethers.utils.parseEther('100000')

    // Initialize the Proxy__Teleportation contract
    if (redeploy) {
      let res = await Proxy__LightBridge.initialize()
      file.log(fileName, `Initialized proxy: ${await res.wait()}`)
      res = await LightBridge.initialize()
      file.log(fileName, `Teleportation initialized: ${await res.wait()}`)
    } else {
      try {
        const disburser = await LightBridge.disburser()
        if (!disburser || disburser === ethers.constants.AddressZero) {
          // not initialized
          let res = await Proxy__LightBridge.initialize()
          file.log(fileName, `Initialized proxy: ${await res.wait()}`)
          res = await LightBridge.initialize()
          file.log(fileName, `Teleportation initialized: ${await res.wait()}`)
        } else {
          file.log(fileName, `Not initializing contract again as already done.`)
        }
      } catch(err) {
        file.log(fileName, `Could not initialized not initialized contracts for already deployed contracts: ${JSON.stringify(err)}`)
      }
    }

    /*
    We basically have 2 Assets that we will support as of now depending on the route/network:
    Boba
    ETH
    And we have 3 parameters/limits to set:
    minimum amount per tx
    maximum amount per tx
    maximum amount per day in overall
    For ETH I would suggest:
    minimum: 0.01 ETH
    maximum: 2 ETH
    maximum per day: 6 ETH
    For BOBA:
    minimum: 20 BOBA
    maximum: 20k BOBA (appr. 5k rn)
    maximum per day: 40k BOBA (appr. 10k rn)
    */

    // TODO: Add Mainnet routes
    type Route = {
      fromChainId: ChainIds,
      toChainId: ChainIds,
      fromTokenAddr: string,
      minAmount: BigNumber,
      maxAmount: BigNumber,
      maxDailyAmount: BigNumber,
    }
    const desiredRoutes: Route[] = [
      // ETH: ETH <-> ETH BOBA
      {
        fromChainId: ChainIds.GOERLI_TESTNET,
        toChainId: ChainIds.BOBA_GOERLI_TESTNET,
        fromTokenAddr: '0x0000000000000000000000000000000000000000', // eth
        minAmount: defMinAmount,
        maxAmount: defMaxAmount,
        maxDailyAmount: defMaxDailyAmount,
      },
      {
        fromChainId: ChainIds.BOBA_GOERLI_TESTNET,
        toChainId: ChainIds.GOERLI_TESTNET,
        fromTokenAddr: '0x0000000000000000000000000000000000000000', // eth
        minAmount: defMinAmount,
        maxAmount: defMaxAmount,
        maxDailyAmount: defMaxDailyAmount,
      },
      // ETH: BNB <-> BNB BOBA
      {
        fromChainId: ChainIds.BNB_TESTNET,
        toChainId: ChainIds.BOBA_BNB_TESTNET,
        fromTokenAddr: '0xd66c6B4F0be8CE5b39D52E0Fd1344c389929B378', // eth
        minAmount: defMinAmount,
        maxAmount: defMaxAmount,
        maxDailyAmount: defMaxDailyAmount,
      },
      {
        fromChainId: ChainIds.BOBA_BNB_TESTNET,
        toChainId: ChainIds.BNB_TESTNET,
        fromTokenAddr: '0xc614A66f82e71758Fa7735C91dAD1088c8362f15', // eth
        minAmount: defMinAmount,
        maxAmount: defMaxAmount,
        maxDailyAmount: defMaxDailyAmount,
      },
      // BOBA: ETH <-> ETH Boba
      {
        fromChainId: ChainIds.GOERLI_TESTNET,
        toChainId: ChainIds.BOBA_GOERLI_TESTNET,
        fromTokenAddr: '0xeCCD355862591CBB4bB7E7dD55072070ee3d0fC1', // boba
        minAmount: defMinAmount,
        maxAmount: defMaxAmount,
        maxDailyAmount: defMaxDailyAmount,
      },
      {
        fromChainId: ChainIds.BOBA_GOERLI_TESTNET,
        toChainId: ChainIds.GOERLI_TESTNET,
        fromTokenAddr: '0x4200000000000000000000000000000000000023', // boba
        minAmount: defMinAmount,
        maxAmount: defMaxAmount,
        maxDailyAmount: defMaxDailyAmount,
      },
      // BOBA: ETH <-> BNB
      {
        fromChainId: ChainIds.GOERLI_TESTNET,
        toChainId: ChainIds.BNB_TESTNET,
        fromTokenAddr: '0xeCCD355862591CBB4bB7E7dD55072070ee3d0fC1', // boba
        minAmount: defMinAmount,
        maxAmount: defMaxAmount,
        maxDailyAmount: defMaxDailyAmount,
      },
      {
        fromChainId: ChainIds.BNB_TESTNET,
        toChainId: ChainIds.GOERLI_TESTNET,
        fromTokenAddr: '0x875cD11fDf085e0E11B0EE6b814b6d0b38fA554C', // boba
        minAmount: defMinAmount,
        maxAmount: defMaxAmount,
        maxDailyAmount: defMaxDailyAmount,
      },
      // BOBA: BNB <-> Boba BNB
      {
        fromChainId: ChainIds.BNB_TESTNET,
        toChainId: ChainIds.BOBA_BNB_TESTNET,
        fromTokenAddr: '0x875cD11fDf085e0E11B0EE6b814b6d0b38fA554C', // boba
        minAmount: defMinAmount,
        maxAmount: defMaxAmount,
        maxDailyAmount: defMaxDailyAmount,
      },
      {
        fromChainId: ChainIds.BOBA_BNB_TESTNET,
        toChainId: ChainIds.BNB_TESTNET,
        fromTokenAddr: '0x0000000000000000000000000000000000000000', // boba
        minAmount: defMinAmount,
        maxAmount: defMaxAmount,
        maxDailyAmount: defMaxDailyAmount,
      },
      // BOBA: ETH BOBA <-> Boba BNB
      {
        fromChainId: ChainIds.BOBA_GOERLI_TESTNET,
        toChainId: ChainIds.BOBA_BNB_TESTNET,
        fromTokenAddr: '0x4200000000000000000000000000000000000023', // boba
        minAmount: defMinAmount,
        maxAmount: defMaxAmount,
        maxDailyAmount: defMaxDailyAmount,
      },
      {
        fromChainId: ChainIds.BOBA_BNB_TESTNET,
        toChainId: ChainIds.BOBA_GOERLI_TESTNET,
        fromTokenAddr: '0x0000000000000000000000000000000000000000', // boba
        minAmount: defMinAmount,
        maxAmount: defMaxAmount,
        maxDailyAmount: defMaxDailyAmount,
      },
      // BOBA: ETH BOBA <-> BNB
      {
        fromChainId: ChainIds.BOBA_GOERLI_TESTNET,
        toChainId: ChainIds.BNB_TESTNET,
        fromTokenAddr: '0x4200000000000000000000000000000000000023', // boba
        minAmount: defMinAmount,
        maxAmount: defMaxAmount,
        maxDailyAmount: defMaxDailyAmount,
      },
      {
        fromChainId: ChainIds.BNB_TESTNET,
        toChainId: ChainIds.BOBA_GOERLI_TESTNET,
        fromTokenAddr: '0x875cD11fDf085e0E11B0EE6b814b6d0b38fA554C', // boba
        minAmount: defMinAmount,
        maxAmount: defMaxAmount,
        maxDailyAmount: defMaxDailyAmount,
      },
      // limitedNetworks (ARB/OP)
      {
        // only supporting onboarding
        fromChainId: ChainIds.OPTIMISM_TESTNET,
        toChainId: ChainIds.BOBA_GOERLI_TESTNET,
        fromTokenAddr: '0x0000000000000000000000000000000000000000', // eth
        minAmount: defMinAmount,
        maxAmount: defMaxAmount,
        maxDailyAmount: defMaxDailyAmount,
      },
      {
        // only supporting onboarding
        fromChainId: ChainIds.ARBITRUM_TESTNET,
        toChainId: ChainIds.BOBA_GOERLI_TESTNET,
        fromTokenAddr: '0x0000000000000000000000000000000000000000', // eth
        minAmount: defMinAmount,
        maxAmount: defMaxAmount,
        maxDailyAmount: defMaxDailyAmount,
      },
      // NOTE: Boba token not supported for OP/ARB, as not deployed there (thus Boba BNB where Boba is native is not supported & no WETH available)
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
        )
        const routeRes = await Proxy__LightBridge.addSupportedToken(
            fromTokenAddr,
            toChainId,
            minAmount,
            maxAmount,
            maxDailyAmount,
        )
        file.log(
            fileName,
            `Added route for ${toChainId} chain, and token: ${fromTokenAddr}, receipt: ${await routeRes.wait()}`
        )
      } catch(err) {
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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

