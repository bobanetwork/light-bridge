import { expect } from './setup'

/* External Imports */
import { ethers, network } from 'hardhat'
import {
  BigNumber,
  constants,
  Contract,
  ContractFactory,
  providers,
  Signer,
  utils,
  Wallet,
} from 'ethers'
import { orderBy } from 'lodash'

/* Imports: Artifacts */
import LightBridgeJson from '../artifacts/contracts/LightBridge.sol/LightBridge.json'
import L1ERC20Json from '../artifacts/contracts/test-helpers/L1ERC20.sol/L1ERC20.json'

/* Imports: Core */
import { LightBridgeService } from '../src'
import { AppDataSource, historyDataRepository } from '../src/data-source'
import {
  Asset,
  EAirdropSource,
  ChainInfo,
  BobaChains,
} from '@bobanetwork/light-bridge-chains'
import dotenv from 'dotenv'
import { delay } from '../src/utils/misc.utils'
import { selectedNetworkFilter } from '../src/exec/lightbridge-instance'

dotenv.config()

// Here to have an easy way to modify globally
const airdropConfig = {
  airdropAmountWei: ethers.utils.parseEther('1'),
  airdropCooldownSeconds: 1000,
}

describe('lightbridge', () => {
  let providerUrl: string
  let providerBnbUrl: string
  let provider: providers.JsonRpcProvider
  let providerBnb: providers.JsonRpcProvider
  let signer: Signer
  let signerBnb: Signer
  let signerAddr: string

  let wallet1: Wallet
  let wallet1Bnb: Wallet
  let address1: string

  let selectedBobaChains: ChainInfo[]
  let selectedBobaChainsBnb: ChainInfo[]
  const pollingInterval: number = 1000

  const defaultMinDepositAmount = utils.parseEther('1')
  const defaultMaxDepositAmount = utils.parseEther('100')
  const defaultMaxTransferPerDay = utils.parseEther('100000')

  after(async () => {
    // Reset blockchain state
    await provider.send('evm_revert', ['0x1'])
  })

  before(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize()
    } else {
      await AppDataSource.dropDatabase()
    }
    await AppDataSource.synchronize(true) // drops database and recreates

    providerUrl = 'http://anvil_eth:8545'
    providerBnbUrl = 'http://anvil_bnb:8545'
    provider = new providers.JsonRpcProvider(providerUrl)
    providerBnb = new providers.JsonRpcProvider(providerBnbUrl)
    console.warn('Using provider: ', providerUrl)

    await provider.send('evm_snapshot', [])

    // must be the same as for AWS KMS (see kms-seed.yml)
    signer = new Wallet(
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
      provider
    ) // PK used by anvil (public anyway)
    signerBnb = signer.connect(providerBnb)
    signerAddr = await signer.getAddress()
    wallet1 = new Wallet(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      provider
    ) // PK used by anvil (public anyway)
    wallet1Bnb = wallet1.connect(providerBnb)
    address1 = wallet1.address

    await signer.sendTransaction({
      to: wallet1.address,
      value: ethers.utils.parseEther('100'),
    })
    await signerBnb.sendTransaction({
      to: wallet1.address,
      value: ethers.utils.parseEther('100'),
    })
  })

  let chainId: number
  let chainIdBobaBnb: number
  let Factory__Teleportation: ContractFactory
  let LightBridge: Contract
  let LightBridgeBNB: Contract

  let Factory__L2BOBA: ContractFactory
  let L2BOBA: Contract
  let L2BNBOnBobaBnb: Contract
  let L2BNBOnBobaEth: Contract

  before(async () => {
    chainId = (await provider.getNetwork()).chainId
    chainIdBobaBnb = (await providerBnb.getNetwork()).chainId

    Factory__Teleportation = new ethers.ContractFactory(
      LightBridgeJson.abi,
      LightBridgeJson.bytecode,
      wallet1
    )

    LightBridge = await Factory__Teleportation.deploy()
    await LightBridge.deployTransaction.wait()

    Factory__L2BOBA = new ethers.ContractFactory(
      L1ERC20Json.abi,
      L1ERC20Json.bytecode,
      signer
    )
    L2BOBA = await Factory__L2BOBA.deploy(
      utils.parseEther('100000000000'),
      'BOBA',
      'BOBA',
      18
    )
    await L2BOBA.deployTransaction.wait()
    await L2BOBA.transfer(address1, utils.parseEther('100000000'))

    // intialize the teleportation contract
    await LightBridge.initialize()
    // add the supported chain & token
    await LightBridge.addSupportedToken(
      L2BOBA.address,
      chainId,
      defaultMinDepositAmount,
      defaultMaxDepositAmount,
      defaultMaxTransferPerDay
    )
    await LightBridge.addSupportedToken(
      ethers.constants.AddressZero,
      chainId,
      defaultMinDepositAmount,
      defaultMaxDepositAmount,
      defaultMaxTransferPerDay
    )

    // build payload
    selectedBobaChains = [
      {
        chainId,
        url: providerUrl,
        provider: provider,
        testnet: true,
        name: 'localhost',
        teleportationAddress: LightBridge.address,
        height: 0,
        supportedAssets: {
          [L2BOBA.address?.toLowerCase()]: Asset.BOBA,
          [ethers.constants.AddressZero?.toLowerCase()]: Asset.ETH,
        },
        airdropConfig: { ...airdropConfig, airdropEnabled: false },
        layer: EAirdropSource.ALLOW,
      },
      // bnb will be added in routing tests to have cleaner before hooks
    ]
    selectedBobaChainsBnb = selectedBobaChains
  })

  const startLightBridgeService = async (
    useBnb?: boolean,
    airdropEnabled?: boolean,
    sourceLayerOverride?: EAirdropSource,
    overrideProvider?: providers.JsonRpcProvider
  ) => {
    const chainIdToUse = useBnb ? chainIdBobaBnb : chainId
    const overridenBobaChains = (
      useBnb ? selectedBobaChainsBnb : selectedBobaChains
    ).map((c) => {
      c.layer = sourceLayerOverride ?? c.layer
      return c
    })

    return new LightBridgeService({
      // sometimes the same network with a different chain id is used
      l2RpcProvider: overrideProvider ?? provider,
      chainId: chainIdToUse,
      lightBridgeAddress: useBnb ? LightBridgeBNB.address : LightBridge.address,
      selectedBobaChains: overridenBobaChains,
      // only defined one other for the routing tests (so idx 0 = own origin network)
      ownSupportedAssets: useBnb
        ? selectedBobaChains[0].supportedAssets
        : selectedBobaChainsBnb[0].supportedAssets,
      pollingInterval,
      blockRangePerPolling: 1000,
      enableExitFee: false, // to not have to deal with exit fees in tests
      awsConfig: {
        // Default values for local kms endpoint
        awsKmsAccessKey: process.env.LIGHTBRIDGE_AWS_KMS_ACCESS_KEY ?? '1',
        awsKmsSecretKey: process.env.LIGHTBRIDGE_AWS_KMS_SECRET_KEY ?? '2',
        awsKmsKeyId:
          process.env.LIGHTBRIDGE_AWS_KMS_KEY_ID ?? 'lb_disburser_pk',
        awsKmsEndpoint:
          process.env.LIGHTBRIDGE_AWS_KMS_ENDPOINT ?? 'http://kms:8888/',
        awsKmsRegion: process.env.LIGHTBRIDGE_AWS_KMS_REGION ?? 'us-east-1',
        disableDisburserCheck: true,
      },
      airdropConfig: {
        ...airdropConfig,
        airdropEnabled,
      },
    })
  }

  const waitForSubgraph = async () => {
    await provider.send('anvil_mine', [])
    await delay(4000)
  }

  it('should create LightBridgeService', async () => {
    const teleportationService = await startLightBridgeService()
    await teleportationService.init()
  })

  describe('unit function tests', () => {
    it('should get an event from LightBridge contract and disburse it', async () => {
      const teleportationService = await startLightBridgeService()
      await teleportationService.init()

      const blockNumber = await provider.getBlockNumber()

      const events = await teleportationService._getAssetReceivedEvents(
        chainId,
        chainId,
        0,
        blockNumber
      )
      expect(events.length).to.be.eq(0)

      // deposit token
      await L2BOBA.approve(LightBridge.address, utils.parseEther('10'))
      const res = await LightBridge.connect(signer).teleportAsset(
        L2BOBA.address,
        utils.parseEther('10'),
        chainId
      )
      await res.wait()

      await waitForSubgraph()

      const latestBlockNumber = await provider.getBlockNumber()
      const latestEvents = await teleportationService._getAssetReceivedEvents(
        chainId,
        chainId,
        0,
        latestBlockNumber
      )

      expect(latestEvents.length).to.be.eq(1)
      expect(latestEvents[0].sourceChainId.toString()).to.be.eq(
        chainId.toString()
      )
      expect(latestEvents[0].toChainId.toString()).to.be.eq(chainId.toString())
      expect(latestEvents[0].depositId.toString()).to.be.eq('0')
      expect(latestEvents[0].emitter.toLowerCase()).to.be.eq(
        signerAddr.toLowerCase()
      )
      expect(latestEvents[0].amount).to.be.eq(utils.parseEther('10'))

      let disbursement = []
      for (const event of latestEvents) {
        const sourceChainId = event.sourceChainId
        const depositId = event.depositId
        const amount = event.amount
        const token = event.token
        const emitter = event.emitter

        disbursement = [
          ...disbursement,
          {
            token,
            amount: amount.toString(),
            addr: emitter,
            depositId: parseInt(depositId.toString()),
            sourceChainId: sourceChainId.toString(),
          },
        ]
      }

      disbursement = orderBy(disbursement, ['depositId'], ['asc'])

      const preBOBABalance = await L2BOBA.balanceOf(address1)
      const preSignerBOBABalance = await L2BOBA.balanceOf(signerAddr)

      await teleportationService._disburseTx(disbursement, chainId, blockNumber)

      const postBOBABalance = await L2BOBA.balanceOf(address1)
      const postSignerBOBABalance = await L2BOBA.balanceOf(signerAddr)

      expect(preBOBABalance.sub(postBOBABalance)).to.be.eq(
        utils.parseEther('10')
      )
      expect(postSignerBOBABalance.sub(preSignerBOBABalance)).to.be.eq(
        utils.parseEther('10')
      )

      const amountDisbursements = await LightBridge.connect(
        signer
      ).totalDisbursements(chainId)

      expect(amountDisbursements).to.be.eq(1)
    })

    it('should block the disbursement TX if it is already disbursed', async () => {
      const teleportationService = await startLightBridgeService()
      await teleportationService.init()

      const blockNumber = await provider.getBlockNumber()
      const events = await teleportationService._getAssetReceivedEvents(
        chainId,
        chainId,
        0,
        blockNumber
      )

      let disbursement = []
      for (const event of events) {
        const sourceChainId = event.sourceChainId
        const depositId = event.depositId
        const amount = event.amount
        const emitter = event.emitter
        const token = event.token

        disbursement = [
          ...disbursement,
          {
            token,
            amount: amount.toString(),
            addr: emitter,
            depositId: parseInt(depositId.toString()),
            sourceChainId: sourceChainId.toString(),
          },
        ]
      }

      disbursement = orderBy(disbursement, ['depositId'], ['asc'])

      const preBOBABalance = await L2BOBA.balanceOf(address1)
      const preSignerBOBABalance = await L2BOBA.balanceOf(signerAddr)

      await teleportationService._disburseTx(disbursement, chainId, blockNumber)

      const postBOBABalance = await L2BOBA.balanceOf(address1)
      const postSignerBOBABalance = await L2BOBA.balanceOf(signerAddr)

      expect(preBOBABalance).to.be.eq(postBOBABalance)
      expect(preSignerBOBABalance).to.be.eq(postSignerBOBABalance)
    })

    it('should get events from Teleportation contract', async () => {
      const teleportationService = await startLightBridgeService()
      await teleportationService.init()

      const startBlockNumber = await provider.getBlockNumber()

      // deposit token
      const lastDisbursement = await LightBridge.connect(
        signer
      ).totalDisbursements(chainId)
      for (let i = 0; i < 15; i++) {
        await L2BOBA.approve(LightBridge.address, utils.parseEther('10'))
        const res = await LightBridge.connect(signer).teleportAsset(
          L2BOBA.address,
          utils.parseEther('10'),
          chainId
        )
        await res.wait()
      }
      await waitForSubgraph()

      const endBlockNumber = await provider.getBlockNumber()
      const latestEvents = await teleportationService._getAssetReceivedEvents(
        chainId,
        chainId,
        startBlockNumber,
        endBlockNumber,
        null,
        lastDisbursement
      )

      expect(latestEvents.length).to.be.eq(15)
    })

    it('should slice events into chunks and send disbursements', async () => {
      const teleportationService = await startLightBridgeService()
      await teleportationService.init()

      await waitForSubgraph()

      const blockNumber = await provider.getBlockNumber()
      const events = await teleportationService._getAssetReceivedEvents(
        chainId,
        chainId,
        0,
        blockNumber
      )
      const lastDisbursement = await LightBridge.totalDisbursements(chainId)

      let disbursement = []
      for (const event of events) {
        const token = event.token
        const sourceChainId = event.sourceChainId
        const depositId = event.depositId
        const amount = event.amount
        const emitter = event.emitter

        if (!parseInt(depositId.toString()) < lastDisbursement.toNumber()) {
          disbursement = [
            ...disbursement,
            {
              token,
              amount: amount.toString(),
              addr: emitter,
              depositId: parseInt(depositId.toString()),
              sourceChainId: sourceChainId.toString(),
            },
          ]
        }
      }

      disbursement = orderBy(disbursement, ['depositId'], ['asc'])

      const preBOBABalance = await L2BOBA.balanceOf(address1)
      const preSignerBOBABalance = await L2BOBA.balanceOf(signerAddr)
      const preBlockNumber = await provider.getBlockNumber()

      await teleportationService._disburseTx(disbursement, chainId, blockNumber)

      const postBOBABalance = await L2BOBA.balanceOf(address1)
      const postSignerBOBABalance = await L2BOBA.balanceOf(signerAddr)
      const postBlockNumber = await provider.getBlockNumber()

      expect(preBOBABalance.sub(postBOBABalance)).to.be.eq(
        utils.parseEther('150')
      )
      expect(postSignerBOBABalance.sub(preSignerBOBABalance)).to.be.eq(
        utils.parseEther('150')
      )
      expect(postBlockNumber).to.be.not.eq(preBlockNumber)
    })
  })

  describe('global tests', () => {
    it('should watch Teleportation contract', async () => {
      const teleportationService = await startLightBridgeService()
      await teleportationService.init()

      // deposit token
      await L2BOBA.approve(LightBridge.address, utils.parseEther('11'))
      const res = await LightBridge.connect(signer).teleportAsset(
        L2BOBA.address,
        utils.parseEther('11'),
        chainId
      )
      await res.wait()

      await waitForSubgraph()

      // check events
      const latestBlock = await provider.getBlockNumber()
      const depositTeleportations = {
        Teleportation: LightBridge,
        chainId,
        totalDeposits: BigNumber.from('0'),
        totalDisbursements: BigNumber.from('0'),
        height: 0,
      }
      const events = await teleportationService._watchTeleportation(
        depositTeleportations,
        latestBlock
      )
      expect(events.length).to.be.eq(1)
      expect(events[0].token.toLowerCase()).to.be.eq(
        L2BOBA.address.toLowerCase()
      )
      expect(events[0].sourceChainId.toString()).to.be.eq(chainId.toString())
      expect(events[0].toChainId.toString()).to.be.eq(chainId.toString())
      expect(events[0].depositId.toString()).to.be.eq('16')
      expect(events[0].emitter.toLowerCase()).to.be.eq(signerAddr.toLowerCase())
      expect(events[0].amount).to.be.eq(utils.parseEther('11'))
    })

    it('should disburse BOBA token for a single event', async () => {
      const teleportationService = await startLightBridgeService()
      await teleportationService.init()

      const latestBlock = await provider.getBlockNumber()
      const depositTeleportations = {
        Teleportation: LightBridge,
        chainId,
        totalDeposits: BigNumber.from('0'),
        totalDisbursements: BigNumber.from('0'),
        height: 0,
      }
      const events = await teleportationService._watchTeleportation(
        depositTeleportations,
        latestBlock
      )

      const preBOBABalance = await L2BOBA.balanceOf(address1)
      await teleportationService._disburseTeleportation(
        depositTeleportations,
        events,
        0
      )
      const postBOBABalance = await L2BOBA.balanceOf(address1)
      expect(preBOBABalance.sub(postBOBABalance)).to.be.eq(
        utils.parseEther('11')
      )

      // should not relay twice
      await teleportationService._disburseTeleportation(
        depositTeleportations,
        events,
        latestBlock
      )
      const BOBABalance = await L2BOBA.balanceOf(address1)
      expect(BOBABalance).to.be.eq(postBOBABalance)

      // should store the latest block
      const storedBlock = await teleportationService._getDepositInfo(chainId)
      expect(storedBlock).to.be.eq(latestBlock)
    }).retries(3)

    it('should get all AssetReceived events', async () => {
      const teleportationService = await startLightBridgeService()
      await teleportationService.init()

      // deposit token
      await L2BOBA.approve(LightBridge.address, utils.parseEther('100'))
      for (let i = 0; i < 11; i++) {
        const res = await LightBridge.connect(signer).teleportAsset(
          L2BOBA.address,
          utils.parseEther('1'),
          chainId
        )
        await res.wait()
      }
      await waitForSubgraph()

      // check events
      const latestBlock = await provider.getBlockNumber()
      const depositTeleportations = {
        Teleportation: LightBridge,
        chainId,
        totalDeposits: BigNumber.from('0'),
        totalDisbursements: BigNumber.from('0'),
        height: 0,
      }
      const events = await teleportationService._watchTeleportation(
        depositTeleportations,
        latestBlock
      )
      expect(events.length).to.be.eq(11)
    })

    it('should disburse BOBA token for all events', async () => {
      const teleportationService = await startLightBridgeService()
      await teleportationService.init()

      const latestBlock = await provider.getBlockNumber()
      const depositTeleportations = {
        Teleportation: LightBridge,
        chainId,
        totalDeposits: BigNumber.from('0'),
        totalDisbursements: BigNumber.from('0'),
        height: 0,
      }
      const events = await teleportationService._watchTeleportation(
        depositTeleportations,
        latestBlock
      )

      const preBOBABalance = await L2BOBA.balanceOf(address1)
      await teleportationService._disburseTeleportation(
        depositTeleportations,
        events,
        0
      )
      const postBOBABalance = await L2BOBA.balanceOf(address1)
      expect(preBOBABalance.sub(postBOBABalance)).to.be.eq(
        utils.parseEther('11')
      )

      // should not relay twice
      await teleportationService._disburseTeleportation(
        depositTeleportations,
        events,
        latestBlock
      )
      const BOBABalance = await L2BOBA.balanceOf(address1)
      expect(BOBABalance).to.be.eq(postBOBABalance)

      // should store the latest block
      const storedBlock = await teleportationService._getDepositInfo(chainId)
      expect(storedBlock).to.be.eq(latestBlock)
    }).retries(3)

    it('should get all AssetReceived events & disburse with exit fee percentage', async () => {
      const teleportationService = await startLightBridgeService()
      await teleportationService.init()

      await LightBridge.setPercentExitFee(500, chainId)
      // deposit token
      await L2BOBA.approve(LightBridge.address, utils.parseEther('10'))

      const res = await LightBridge.connect(signer).teleportAsset(
        L2BOBA.address,
        utils.parseEther('10'),
        chainId
      )

      await res.wait()
      await waitForSubgraph()

      // check events
      const latestBlock = await provider.getBlockNumber()
      const depositTeleportations = {
        Teleportation: LightBridge,
        chainId,
        totalDeposits: BigNumber.from('0'),
        totalDisbursements: BigNumber.from('0'),
        height: 0,
      }
      const events = await teleportationService._watchTeleportation(
        depositTeleportations,
        latestBlock
      )
      expect(events.length).to.be.eq(1)

      const preBOBABalance = await L2BOBA.balanceOf(address1)
      await teleportationService._disburseTeleportation(
        depositTeleportations,
        events,
        0
      )
      const fee = utils.parseEther('10').mul(500).div(10000)
      const postBOBABalance = await L2BOBA.balanceOf(address1)
      expect(preBOBABalance.sub(postBOBABalance)).to.be.eq(
        utils.parseEther('10').sub(fee)
      )

      // should not relay twice
      await teleportationService._disburseTeleportation(
        depositTeleportations,
        events,
        latestBlock
      )
      const BOBABalance = await L2BOBA.balanceOf(address1)
      expect(BOBABalance).to.be.eq(postBOBABalance)

      // should store the latest block
      const storedBlock = await teleportationService._getDepositInfo(chainId)
      expect(storedBlock).to.be.eq(latestBlock)
      await LightBridge.setPercentExitFee(0, chainId)
    })

    it('should not disburse BOBA token if the data is reset', async () => {
      const teleportationService = await startLightBridgeService()
      await teleportationService.init()

      await historyDataRepository.delete({ depositChainId: chainId })

      const latestBlock = await provider.getBlockNumber()
      const depositTeleportations = {
        Teleportation: LightBridge,
        chainId,
        totalDeposits: BigNumber.from('0'),
        totalDisbursements: BigNumber.from('0'),
        height: 0,
      }
      const events = await teleportationService._watchTeleportation(
        depositTeleportations,
        latestBlock
      )

      const preBOBABalance = await L2BOBA.balanceOf(address1)
      await teleportationService._disburseTeleportation(
        depositTeleportations,
        events,
        0
      )
      const postBOBABalance = await L2BOBA.balanceOf(address1)
      expect(preBOBABalance.sub(postBOBABalance)).to.be.eq(0)
    })
  })

  describe('asset routing', () => {
    before(async () => {
      LightBridgeBNB = await Factory__Teleportation.connect(wallet1Bnb).deploy()
      await LightBridgeBNB.deployTransaction.wait()

      // deploy other token for routing tests
      L2BNBOnBobaEth = await Factory__L2BOBA.deploy(
        utils.parseEther('100000000000'),
        'BNB',
        'BNB',
        18
      )
      await L2BNBOnBobaEth.deployTransaction.wait()
      await L2BNBOnBobaEth.transfer(address1, utils.parseEther('100000000'))

      // deploy other token for routing tests
      L2BNBOnBobaBnb = await Factory__L2BOBA.connect(signerBnb).deploy(
        utils.parseEther('100000000000'),
        'BNB',
        'BNB',
        18
      )
      await L2BNBOnBobaBnb.deployTransaction.wait()
      await L2BNBOnBobaBnb.transfer(address1, utils.parseEther('100000000'))

      // intialize the teleportation contract
      await LightBridgeBNB.initialize()

      // add the supported chain & token
      await LightBridgeBNB.addSupportedToken(
        L2BNBOnBobaBnb.address,
        chainId,
        defaultMinDepositAmount,
        defaultMaxDepositAmount,
        defaultMaxTransferPerDay
      )
      await LightBridgeBNB.addSupportedToken(
        ethers.constants.AddressZero,
        chainId,
        defaultMinDepositAmount,
        defaultMaxDepositAmount,
        defaultMaxTransferPerDay
      )

      // add support on previous network
      await LightBridge.addSupportedToken(
        L2BNBOnBobaEth.address,
        chainIdBobaBnb,
        defaultMinDepositAmount,
        defaultMaxDepositAmount,
        defaultMaxTransferPerDay
      )
      await LightBridge.addSupportedToken(
        L2BOBA.address,
        chainIdBobaBnb,
        defaultMinDepositAmount,
        defaultMaxDepositAmount,
        defaultMaxTransferPerDay
      )

      console.log(
        `Teleportation on ETH: ${LightBridge.address} / on BNB: ${LightBridgeBNB.address}`
      )

      // mock BNB network & overwrite prev network
      selectedBobaChains = [
        {
          chainId: chainIdBobaBnb,
          url: providerBnbUrl,
          provider: providerBnb,
          testnet: true,
          name: 'localhost:bnb',
          teleportationAddress: LightBridgeBNB.address,
          height: 0,
          supportedAssets: {
            [L2BNBOnBobaBnb.address?.toLowerCase()]: Asset.BNB,
            [ethers.constants.AddressZero?.toLowerCase()]: Asset.BOBA,
          },
          airdropConfig: { ...airdropConfig, airdropEnabled: false },
          layer: EAirdropSource.ALLOW,
        },
      ]
      selectedBobaChainsBnb = [
        {
          chainId,
          url: providerUrl,
          provider: provider,
          testnet: true,
          name: 'localhost',
          teleportationAddress: LightBridge.address,
          height: 0,
          supportedAssets: {
            [ethers.constants.AddressZero?.toLowerCase()]: Asset.ETH,
            [L2BNBOnBobaEth.address?.toLowerCase()]: Asset.BNB,
            [L2BOBA.address?.toLowerCase()]: Asset.BOBA,
          },
          airdropConfig: { ...airdropConfig, airdropEnabled: false },
          layer: EAirdropSource.ALLOW,
        },
      ]
    })

    it('teleport BOBA as native from chain A (e.g. BNB) to chain B as token (ETH)', async () => {
      const teleportationServiceBnb = await startLightBridgeService(
        true,
        null,
        null,
        providerBnb
      )
      await teleportationServiceBnb.init()

      // deposit token
      const preBlockNumber = await providerBnb.getBlockNumber()
      const res = await LightBridgeBNB.connect(signerBnb).teleportAsset(
        constants.AddressZero, // send native BOBA
        utils.parseEther('10'),
        chainId, // toChainId,
        { value: utils.parseEther('10') }
      )
      await res.wait()
      await waitForSubgraph()

      const blockNumber = await providerBnb.getBlockNumber()
      const events = await teleportationServiceBnb._getAssetReceivedEvents(
        chainIdBobaBnb,
        chainId,
        preBlockNumber,
        blockNumber
      )

      expect(events.length).to.be.gt(0, 'Event length must be greater than 0')

      const teleportationServiceEth = await startLightBridgeService(false)
      await teleportationServiceEth.init()

      let disbursement = []
      for (const event of events) {
        const sourceChainId = event.sourceChainId
        const depositId = event.depositId
        const amount = event.amount
        const token = event.token
        const emitter = event.emitter

        const receivingChainTokenAddr =
          teleportationServiceEth._getSupportedDestChainTokenAddrBySourceChainTokenAddr(
            token,
            sourceChainId
          )
        expect(receivingChainTokenAddr.toLowerCase()).to.be.eq(
          L2BOBA.address.toLowerCase(),
          'BOBA token address on Boba BNB not correctly routed'
        )

        disbursement = [
          ...disbursement,
          {
            token: receivingChainTokenAddr,
            amount: amount.toString(),
            addr: emitter,
            depositId: parseInt(depositId.toString()),
            sourceChainId: sourceChainId.toString(),
          },
        ]
      }

      console.log('Added disbursement: ', disbursement)

      disbursement = orderBy(disbursement, ['depositId'], ['asc'])

      const preBOBABalance = await L2BOBA.balanceOf(address1)
      const preSignerBOBABalance = await L2BOBA.balanceOf(signerAddr)

      await teleportationServiceEth._disburseTx(
        disbursement,
        chainId,
        blockNumber
      )

      const postBOBABalance = await L2BOBA.balanceOf(address1)
      const postSignerBOBABalance = await L2BOBA.balanceOf(signerAddr)

      expect(preBOBABalance.sub(postBOBABalance)).to.be.eq(
        utils.parseEther('10')
      )
      expect(postSignerBOBABalance.sub(preSignerBOBABalance)).to.be.eq(
        utils.parseEther('10')
      )
    })

    it('teleport BNB as token from chain B (e.g. Boba BNB) to chain A (ETH) as wrapped token', async () => {
      const teleportationServiceBnb = await startLightBridgeService(
        true,
        null,
        null,
        providerBnb
      )
      await teleportationServiceBnb.init()

      // deposit token
      const preBlockNumber = await providerBnb.getBlockNumber()
      let res = await L2BNBOnBobaBnb.approve(
        LightBridgeBNB.address,
        utils.parseEther('10')
      )
      await res.wait()
      res = await LightBridgeBNB.connect(signerBnb).teleportAsset(
        L2BNBOnBobaBnb.address,
        utils.parseEther('10'),
        chainId // toChainId,
      )
      await res.wait()
      await waitForSubgraph()

      const blockNumber = await providerBnb.getBlockNumber()
      const events = await teleportationServiceBnb._getAssetReceivedEvents(
        chainIdBobaBnb,
        chainId,
        preBlockNumber,
        blockNumber
      )

      expect(events.length).to.be.gte(1, 'Should have at least one event')
      const event = events.find(
        (e) => e.token.toLowerCase() === L2BNBOnBobaBnb.address.toLowerCase()
      )
      console.log(
        'Found events for bnb bridging: ',
        JSON.stringify(events),
        L2BNBOnBobaBnb.address,
        event
      )
      expect(event).to.not.be.undefined

      const teleportationServiceEth = await startLightBridgeService(false)
      await teleportationServiceEth.init()

      let disbursement = []
      const sourceChainId = event.sourceChainId
      const depositId = event.depositId
      const amount = event.amount
      const token = event.token
      const emitter = event.emitter

      const receivingChainTokenAddr =
        teleportationServiceEth._getSupportedDestChainTokenAddrBySourceChainTokenAddr(
          token,
          sourceChainId
        )
      expect(receivingChainTokenAddr.toLowerCase()).to.be.eq(
        L2BNBOnBobaEth.address.toLowerCase(),
        'BNB token address on Boba BNB not correctly routed: ' +
          sourceChainId +
          ', originToken: ' +
          token
      )

      disbursement = [
        {
          token: receivingChainTokenAddr,
          amount: amount.toString(),
          addr: emitter,
          depositId: parseInt(depositId.toString()),
          sourceChainId: sourceChainId.toString(),
        },
      ]

      console.log('Added disbursement: ', disbursement)

      disbursement = orderBy(disbursement, ['depositId'], ['asc'])

      const preBOBABalance = await L2BNBOnBobaEth.balanceOf(address1)
      const preSignerBOBABalance = await L2BNBOnBobaEth.balanceOf(signerAddr)

      await teleportationServiceEth._disburseTx(
        disbursement,
        chainId,
        blockNumber
      )

      const postBOBABalance = await L2BNBOnBobaEth.balanceOf(address1)
      const postSignerBOBABalance = await L2BNBOnBobaEth.balanceOf(signerAddr)

      expect(preBOBABalance.sub(postBOBABalance)).to.be.eq(
        utils.parseEther('10')
      )
      expect(postSignerBOBABalance.sub(preSignerBOBABalance)).to.be.eq(
        utils.parseEther('10')
      )
    })

    it('teleport BOBA as token from chain A (ETH) to chain B (e.g. Boba BNB) as native asset', async () => {
      const teleportationService = await startLightBridgeService(false)
      await teleportationService.init()

      // deposit token
      const preBlockNumber = await provider.getBlockNumber()

      let res = await L2BOBA.approve(
        LightBridge.address,
        utils.parseEther('10')
      )
      await res.wait()
      res = await LightBridge.connect(signer).teleportAsset(
        L2BOBA.address, // send BNB as token
        utils.parseEther('10'),
        chainIdBobaBnb // toChainId
      )
      await res.wait()
      await waitForSubgraph()

      const blockNumber = await provider.getBlockNumber()
      const events = await teleportationService._getAssetReceivedEvents(
        chainId,
        chainIdBobaBnb,
        preBlockNumber,
        blockNumber
      )

      expect(events.length).to.be.gt(0, 'Event length must be greater than 0')

      const teleportationServiceBnb = await startLightBridgeService(
        true,
        null,
        null,
        providerBnb
      )
      await teleportationServiceBnb.init()

      let disbursement = []
      for (const event of events) {
        const sourceChainId = event.sourceChainId
        const depositId = event.depositId
        const amount = event.amount
        const token = event.token
        const emitter = event.emitter

        const receivingChainTokenAddr =
          teleportationServiceBnb._getSupportedDestChainTokenAddrBySourceChainTokenAddr(
            token,
            sourceChainId
          )
        expect(receivingChainTokenAddr).to.be.eq(
          ethers.constants.AddressZero,
          'BOBA native asset on Boba BNB not correctly routed'
        )

        disbursement = [
          ...disbursement,
          {
            token: receivingChainTokenAddr,
            amount: amount.toString(),
            addr: emitter,
            depositId, // artificially increment necessary, as we mocked fake chainId in previous test (to avoid unexpected next depositId)
            sourceChainId: sourceChainId.toString(),
          },
        ]
      }

      disbursement = orderBy(disbursement, ['depositId'], ['asc'])

      const bnbChainInfo = selectedBobaChains.find(
        (c) => c.chainId === chainIdBobaBnb
      )
      if (!bnbChainInfo) {
        throw new Error('BNB provider not configured!')
      }

      const preBNBBalance = await bnbChainInfo.provider.getBalance(address1)
      const preSignerBNBBalance = await bnbChainInfo.provider.getBalance(
        signerAddr
      )

      await teleportationServiceBnb._disburseTx(
        disbursement,
        chainIdBobaBnb,
        blockNumber
      )

      const postBNBBalance = await bnbChainInfo.provider.getBalance(address1)
      const postSignerBNBBalance = await bnbChainInfo.provider.getBalance(
        signerAddr
      )

      expect(preBNBBalance.sub(postBNBBalance)).to.be.closeTo(
        utils.parseEther('9.08'),
        utils.parseEther('10.02') // gas used by disburse transaction(s)
      )
      expect(postSignerBNBBalance.sub(preSignerBNBBalance)).to.be.closeTo(
        utils.parseEther('9.08'),
        utils.parseEther('10.02')
      )
    })
  })

  describe('airdrop checks - reverse', () => {
    before(async () => {
      Factory__Teleportation = new ethers.ContractFactory(
        LightBridgeJson.abi,
        LightBridgeJson.bytecode,
        wallet1
      )

      LightBridge = await Factory__Teleportation.deploy()
      await LightBridge.deployTransaction.wait()

      Factory__L2BOBA = new ethers.ContractFactory(
        L1ERC20Json.abi,
        L1ERC20Json.bytecode,
        signer
      )
      L2BOBA = await Factory__L2BOBA.deploy(
        utils.parseEther('100000000000'),
        'BOBA',
        'BOBA',
        18
      )
      await L2BOBA.deployTransaction.wait()
      await L2BOBA.transfer(address1, utils.parseEther('100000000'))

      // intialize the teleportation contract
      await LightBridge.initialize()

      LightBridgeBNB = await Factory__Teleportation.connect(wallet1Bnb).deploy()
      await LightBridgeBNB.deployTransaction.wait()

      // deploy other token for routing tests
      L2BNBOnBobaBnb = await Factory__L2BOBA.connect(signerBnb).deploy(
        utils.parseEther('100000000000'),
        'BOBA',
        'BOBA',
        18
      )
      await L2BNBOnBobaBnb.deployTransaction.wait()
      await L2BNBOnBobaBnb.transfer(address1, utils.parseEther('100000000'))

      // deploy other token for routing tests
      L2BNBOnBobaEth = await Factory__L2BOBA.deploy(
        utils.parseEther('100000000000'),
        'BNB',
        'BNB',
        18
      )
      await L2BNBOnBobaEth.deployTransaction.wait()
      await L2BNBOnBobaEth.transfer(address1, utils.parseEther('100000000'))

      // intialize the teleportation contract
      await LightBridgeBNB.initialize()

      // add the supported chain & token
      await LightBridgeBNB.addSupportedToken(
        L2BNBOnBobaBnb.address,
        chainId,
        defaultMinDepositAmount,
        defaultMaxDepositAmount,
        defaultMaxTransferPerDay
      )
      await LightBridgeBNB.addSupportedToken(
        ethers.constants.AddressZero,
        chainId,
        defaultMinDepositAmount,
        defaultMaxDepositAmount,
        defaultMaxTransferPerDay
      )

      // add support on previous network
      await LightBridge.addSupportedToken(
        L2BNBOnBobaEth.address,
        chainIdBobaBnb,
        defaultMinDepositAmount,
        defaultMaxDepositAmount,
        defaultMaxTransferPerDay
      )
      await LightBridge.addSupportedToken(
        L2BOBA.address,
        chainIdBobaBnb,
        defaultMinDepositAmount,
        defaultMaxDepositAmount,
        defaultMaxTransferPerDay
      )

      console.log(
        `Teleportation on ETH: ${LightBridge.address} / on BNB: ${LightBridgeBNB.address}`
      )

      // mock BNB network & overwrite prev network
      selectedBobaChains = [
        {
          chainId: chainIdBobaBnb,
          url: providerBnbUrl,
          provider: providerBnb,
          testnet: true,
          name: 'localhost:bnb',
          teleportationAddress: LightBridgeBNB.address,
          height: 0,
          supportedAssets: {
            [L2BNBOnBobaBnb.address?.toLowerCase()]: Asset.BNB,
            [ethers.constants.AddressZero]: Asset.BOBA,
          },
          airdropConfig: { ...airdropConfig, airdropEnabled: false },
          layer: EAirdropSource.ALLOW,
        },
      ]
      selectedBobaChainsBnb = [
        {
          chainId,
          url: providerUrl,
          provider: provider,
          testnet: true,
          name: 'localhost',
          teleportationAddress: LightBridge.address,
          height: 0,
          supportedAssets: {
            [L2BOBA.address?.toLowerCase()]: Asset.BOBA,
            [ethers.constants.AddressZero]: Asset.ETH,
            [L2BNBOnBobaEth.address?.toLowerCase()]: Asset.BNB,
          },
          airdropConfig: { ...airdropConfig, airdropEnabled: false },
          layer: EAirdropSource.ALLOW,
        },
      ]
    })

    it('should not receive gas on airdrop when airdrop disabled (e.g. for L1)', async () => {
      const teleportationServiceBnb = await startLightBridgeService(
        true,
        null,
        null,
        providerBnb
      )
      await teleportationServiceBnb.init()

      // deposit token
      await waitForSubgraph()
      const preBlockNumber = await providerBnb.getBlockNumber()
      let res = await L2BNBOnBobaBnb.connect(signerBnb).approve(
        LightBridgeBNB.address,
        utils.parseEther('10')
      )
      await res.wait()
      res = await LightBridgeBNB.connect(signerBnb).teleportAsset(
        L2BNBOnBobaBnb.address,
        utils.parseEther('10'),
        chainId // toChainId
      )
      await res.wait()
      await waitForSubgraph()

      const blockNumber = await providerBnb.getBlockNumber()
      const events = await teleportationServiceBnb._getAssetReceivedEvents(
        chainIdBobaBnb,
        chainId,
        preBlockNumber,
        blockNumber
      )

      console.log(
        'Teleportation: ',
        LightBridgeBNB.address,
        JSON.stringify(events)
      )
      expect(events.length).to.be.eq(1, 'Event length must be 1')

      const teleportationServiceEth = await startLightBridgeService(
        false,
        false
      )
      await teleportationServiceEth.init()

      // random address to ensure balance = 0 to be eligible for airdrop
      const randAddress = ethers.Wallet.createRandom().address

      const lastEvent = events.find(
        (e) =>
          e.token.toLowerCase() === L2BNBOnBobaBnb.address.toLowerCase() &&
          parseInt(e.block_number) >= preBlockNumber
      )
      expect(lastEvent).to.not.be.undefined
      console.log('Last Event for bnb bridging: ', JSON.stringify(lastEvent))
      const sourceChainId = lastEvent.sourceChainId
      const depositId = lastEvent.depositId
      const amount = lastEvent.amount
      const token = lastEvent.token
      const emitter = lastEvent.emitter

      const receivingChainTokenAddr =
        teleportationServiceEth._getSupportedDestChainTokenAddrBySourceChainTokenAddr(
          token,
          sourceChainId
        )
      expect(receivingChainTokenAddr).to.be.eq(
        L2BNBOnBobaEth.address?.toLowerCase(),
        'BNB token address on BNB not correctly routed'
      )

      let disbursement = [
        {
          token: receivingChainTokenAddr,
          amount: amount.toString(),
          addr: randAddress,
          depositId: parseInt(depositId.toString()),
          sourceChainId: sourceChainId.toString(),
        },
      ]

      console.log('Added disbursement: ', disbursement)

      disbursement = orderBy(disbursement, ['depositId'], ['asc'])

      const preNativeBalance = await provider.getBalance(address1)
      const preSignerNativeBalance = await provider.getBalance(randAddress)
      const preTokenBalance = await L2BNBOnBobaEth.balanceOf(address1)
      const preSignerTokenBalance = await L2BNBOnBobaEth.balanceOf(randAddress)

      await teleportationServiceEth._disburseTx(
        disbursement,
        chainId,
        blockNumber
      )

      const postNativeBalance = await provider.getBalance(address1)
      const postSignerNativeBalance = await provider.getBalance(randAddress)
      const postTokenBalance = await L2BNBOnBobaEth.balanceOf(address1)
      const postSignerTokenBalance = await L2BNBOnBobaEth.balanceOf(randAddress)

      expect(preTokenBalance.sub(postTokenBalance)).to.be.eq(
        utils.parseEther('10')
      )
      expect(postSignerTokenBalance.sub(preSignerTokenBalance)).to.be.eq(
        utils.parseEther('10')
      )
      const gasDelta = ethers.utils.parseEther('0.003')
      expect(preNativeBalance.sub(postNativeBalance)).to.be.closeTo(
        '0',
        gasDelta
      )
      expect(postSignerNativeBalance.sub(preSignerNativeBalance)).to.be.closeTo(
        '0',
        gasDelta
      )
    })

    it('should not airdrop if user bridges asset that is native on destination network', async () => {
      const teleportationService = await startLightBridgeService(true)
      await teleportationService.init()

      // deposit token
      const amountToBridge = utils.parseEther('10')
      const preBlockNumber = await provider.getBlockNumber()
      let res = await L2BOBA.connect(signer).approve(
        LightBridge.address,
        amountToBridge
      )
      await res.wait()
      res = await LightBridge.connect(signer).teleportAsset(
        L2BOBA.address,
        amountToBridge,
        chainIdBobaBnb // toChainId
      )
      await res.wait()
      await waitForSubgraph()

      const blockNumber = await provider.getBlockNumber()
      const events = await teleportationService._getAssetReceivedEvents(
        chainId,
        chainIdBobaBnb,
        preBlockNumber,
        blockNumber
      )

      console.log('Teleportation: ', LightBridge.address)
      expect(events.length).to.be.gt(0, 'Event length must be greater than 0')

      const teleportationServiceBnb = await startLightBridgeService(
        true,
        true,
        null,
        providerBnb
      )
      await teleportationServiceBnb.init()

      // random address to ensure balance = 0 to be eligible for airdrop
      const randAddress = ethers.Wallet.createRandom().address
      const lastEvent = events.find(
        (e) =>
          e.token.toLowerCase() === L2BOBA.address.toLowerCase() &&
          parseInt(e.block_number) >= preBlockNumber
      )
      expect(lastEvent).to.not.be.undefined
      console.log('LAST EVENT: ', JSON.stringify(lastEvent))

      const sourceChainId = lastEvent.sourceChainId
      const depositId = lastEvent.depositId
      const amount = lastEvent.amount
      const token = lastEvent.token
      const emitter = lastEvent.emitter

      const receivingChainTokenAddr =
        teleportationServiceBnb._getSupportedDestChainTokenAddrBySourceChainTokenAddr(
          token,
          sourceChainId
        )
      expect(receivingChainTokenAddr).to.be.eq(
        ethers.constants.AddressZero,
        'BOBA token address on ETH not correctly routed'
      )

      let disbursement = [
        {
          token: receivingChainTokenAddr,
          amount: amount.toString(),
          addr: randAddress,
          depositId: parseInt(depositId.toString()),
          sourceChainId: sourceChainId.toString(),
        },
      ]

      console.log('Added disbursement: ', disbursement)

      disbursement = orderBy(disbursement, ['depositId'], ['asc'])

      const preNativeBalance = await providerBnb.getBalance(address1)
      const preSignerNativeBalance = await providerBnb.getBalance(randAddress)

      await teleportationServiceBnb._disburseTx(
        disbursement,
        chainId,
        blockNumber
      )

      const postNativeBalance = await providerBnb.getBalance(address1)
      const postSignerNativeBalance = await providerBnb.getBalance(randAddress)

      const gasDelta = ethers.utils.parseEther('0.003')
      expect(preNativeBalance.sub(postNativeBalance)).to.be.closeTo(
        amountToBridge,
        gasDelta
      )
      expect(postSignerNativeBalance.sub(preSignerNativeBalance)).to.be.eq(
        amountToBridge
      )
    })
  })

  describe('airdrop checks', () => {
    before(async () => {
      Factory__Teleportation = new ethers.ContractFactory(
        LightBridgeJson.abi,
        LightBridgeJson.bytecode,
        wallet1
      )

      LightBridge = await Factory__Teleportation.deploy()
      await LightBridge.deployTransaction.wait()

      Factory__L2BOBA = new ethers.ContractFactory(
        L1ERC20Json.abi,
        L1ERC20Json.bytecode,
        signer
      )
      L2BOBA = await Factory__L2BOBA.deploy(
        utils.parseEther('100000000000'),
        'BOBA',
        'BOBA',
        18
      )
      await L2BOBA.deployTransaction.wait()
      await L2BOBA.transfer(address1, utils.parseEther('100000000'))

      // intialize the teleportation contract
      await LightBridge.initialize()

      LightBridgeBNB = await Factory__Teleportation.connect(wallet1Bnb).deploy()
      await LightBridgeBNB.deployTransaction.wait()

      // deploy other token for routing tests
      L2BNBOnBobaBnb = await Factory__L2BOBA.connect(signerBnb).deploy(
        utils.parseEther('100000000000'),
        'BOBA',
        'BOBA',
        18
      )
      await L2BNBOnBobaBnb.deployTransaction.wait()
      await L2BNBOnBobaBnb.transfer(address1, utils.parseEther('100000000'))

      // deploy other token for routing tests
      L2BNBOnBobaEth = await Factory__L2BOBA.deploy(
        utils.parseEther('100000000000'),
        'BNB',
        'BNB',
        18
      )
      await L2BNBOnBobaEth.deployTransaction.wait()
      await L2BNBOnBobaEth.transfer(address1, utils.parseEther('100000000'))

      // intialize the teleportation contract
      await LightBridgeBNB.initialize()

      // add the supported chain & token
      await LightBridgeBNB.addSupportedToken(
        L2BNBOnBobaBnb.address,
        chainId,
        defaultMinDepositAmount,
        defaultMaxDepositAmount,
        defaultMaxTransferPerDay
      )
      await LightBridgeBNB.addSupportedToken(
        ethers.constants.AddressZero,
        chainId,
        defaultMinDepositAmount,
        defaultMaxDepositAmount,
        defaultMaxTransferPerDay
      )

      // add support on previous network
      await LightBridge.addSupportedToken(
        L2BNBOnBobaEth.address,
        chainIdBobaBnb,
        defaultMinDepositAmount,
        defaultMaxDepositAmount,
        defaultMaxTransferPerDay
      )
      await LightBridge.addSupportedToken(
        L2BOBA.address,
        chainIdBobaBnb,
        defaultMinDepositAmount,
        defaultMaxDepositAmount,
        defaultMaxTransferPerDay
      )

      console.log(
        `Teleportation on ETH: ${LightBridge.address} / on BNB: ${LightBridgeBNB.address}`
      )

      // mock BNB network & overwrite prev network
      selectedBobaChains = [
        {
          chainId: chainIdBobaBnb,
          url: providerBnbUrl,
          provider: providerBnb,
          testnet: true,
          name: 'localhost:bnb',
          teleportationAddress: LightBridgeBNB.address,
          height: 0,
          supportedAssets: {
            [L2BNBOnBobaBnb.address?.toLowerCase()]: Asset.BNB,
            [ethers.constants.AddressZero]: Asset.BOBA,
          },
          airdropConfig: { ...airdropConfig, airdropEnabled: false },
          layer: EAirdropSource.ALLOW,
        },
      ]
      selectedBobaChainsBnb = [
        {
          chainId,
          url: providerUrl,
          provider: provider,
          testnet: true,
          name: 'localhost',
          teleportationAddress: LightBridge.address,
          height: 0,
          supportedAssets: {
            [L2BOBA.address?.toLowerCase()]: Asset.BOBA,
            [ethers.constants.AddressZero]: Asset.ETH,
            [L2BNBOnBobaEth.address?.toLowerCase()]: Asset.BNB,
          },
          airdropConfig: { ...airdropConfig, airdropEnabled: false },
          layer: EAirdropSource.ALLOW,
        },
      ]
    })

    it('should not airdrop if user has gas on destination network', async () => {
      const teleportationService = await startLightBridgeService()
      await teleportationService.init()

      // deposit token
      const preBlockNumber = await providerBnb.getBlockNumber()
      let res = await L2BNBOnBobaBnb.connect(signerBnb).approve(
        LightBridgeBNB.address,
        utils.parseEther('10')
      )
      await res.wait()
      res = await LightBridgeBNB.connect(signerBnb).teleportAsset(
        L2BNBOnBobaBnb.address,
        utils.parseEther('10'),
        chainId // toChainId
      )
      await res.wait()
      await waitForSubgraph()

      const blockNumber = await providerBnb.getBlockNumber()

      await wallet1Bnb.sendTransaction({
        to: ethers.Wallet.createRandom().address,
        value: utils.parseEther('10'),
      })

      // subgraph is unstable, so we use contract to get events
      const events = await teleportationService._getAssetReceivedEvents(
        chainIdBobaBnb,
        chainId,
        preBlockNumber,
        blockNumber,
        LightBridgeBNB
      )

      console.log('Teleportation: ', LightBridgeBNB.address)
      expect(events.length).to.be.eq(1, 'Event length must be 1')

      const teleportationServiceEth = await startLightBridgeService(false, true)
      await teleportationServiceEth.init()

      const lastEvent = events[0]
      const sourceChainId = lastEvent.sourceChainId
      const depositId = lastEvent.depositId
      const amount = lastEvent.amount
      const token = lastEvent.token
      const emitter = lastEvent.emitter

      const receivingChainTokenAddr =
        teleportationServiceEth._getSupportedDestChainTokenAddrBySourceChainTokenAddr(
          token,
          sourceChainId
        )
      expect(receivingChainTokenAddr).to.be.eq(
        L2BNBOnBobaEth.address?.toLowerCase(),
        'BNB token address on BNB not correctly routed'
      )

      let disbursement = [
        {
          token: receivingChainTokenAddr,
          amount: amount.toString(),
          addr: emitter,
          depositId: parseInt(depositId.toString()),
          sourceChainId: sourceChainId.toString(),
        },
      ]

      console.log('Added disbursement: ', disbursement)

      disbursement = orderBy(disbursement, ['depositId'], ['asc'])

      const preNativeBalance = await provider.getBalance(address1)
      const preSignerNativeBalance = await provider.getBalance(signerAddr)
      const preTokenBalance = await L2BNBOnBobaEth.balanceOf(address1)
      const preSignerTokenBalance = await L2BNBOnBobaEth.balanceOf(signerAddr)

      await teleportationServiceEth._disburseTx(
        disbursement,
        chainId,
        blockNumber
      )

      const postNativeBalance = await provider.getBalance(address1)
      const postSignerNativeBalance = await provider.getBalance(signerAddr)
      const postTokenBalance = await L2BNBOnBobaEth.balanceOf(address1)
      const postSignerTokenBalance = await L2BNBOnBobaEth.balanceOf(signerAddr)

      expect(preTokenBalance.sub(postTokenBalance)).to.be.eq(
        utils.parseEther('10')
      )
      expect(postSignerTokenBalance.sub(preSignerTokenBalance)).to.be.eq(
        utils.parseEther('10')
      )
      const gasDelta = ethers.utils.parseEther('0.003')
      expect(preNativeBalance.sub(postNativeBalance)).to.be.closeTo(
        '0',
        gasDelta
      )
      expect(postSignerNativeBalance.sub(preSignerNativeBalance)).to.be.closeTo(
        '0',
        gasDelta
      )
    })
  })

  describe('airdrop checks sourcechain', () => {
    before(async () => {
      Factory__Teleportation = new ethers.ContractFactory(
        LightBridgeJson.abi,
        LightBridgeJson.bytecode,
        wallet1
      )

      LightBridge = await Factory__Teleportation.deploy()
      await LightBridge.deployTransaction.wait()

      Factory__L2BOBA = new ethers.ContractFactory(
        L1ERC20Json.abi,
        L1ERC20Json.bytecode,
        signer
      )
      L2BOBA = await Factory__L2BOBA.deploy(
        utils.parseEther('100000000000'),
        'BOBA',
        'BOBA',
        18
      )
      await L2BOBA.deployTransaction.wait()
      await L2BOBA.transfer(address1, utils.parseEther('100000000'))

      // intialize the teleportation contract
      await LightBridge.initialize()

      LightBridgeBNB = await Factory__Teleportation.connect(wallet1Bnb).deploy()
      await LightBridgeBNB.deployTransaction.wait()

      // deploy other token for routing tests
      L2BNBOnBobaBnb = await Factory__L2BOBA.connect(signerBnb).deploy(
        utils.parseEther('100000000000'),
        'BOBA',
        'BOBA',
        18
      )
      await L2BNBOnBobaBnb.deployTransaction.wait()
      await L2BNBOnBobaBnb.transfer(address1, utils.parseEther('100000000'))

      // deploy other token for routing tests
      L2BNBOnBobaEth = await Factory__L2BOBA.deploy(
        utils.parseEther('100000000000'),
        'BNB',
        'BNB',
        18
      )
      await L2BNBOnBobaEth.deployTransaction.wait()
      await L2BNBOnBobaEth.transfer(address1, utils.parseEther('100000000'))

      // intialize the teleportation contract
      await LightBridgeBNB.initialize()

      // add the supported chain & token
      await LightBridgeBNB.addSupportedToken(
        L2BNBOnBobaBnb.address,
        chainId,
        defaultMinDepositAmount,
        defaultMaxDepositAmount,
        defaultMaxTransferPerDay
      )
      await LightBridgeBNB.addSupportedToken(
        ethers.constants.AddressZero,
        chainId,
        defaultMinDepositAmount,
        defaultMaxDepositAmount,
        defaultMaxTransferPerDay
      )

      // add support on previous network
      await LightBridge.addSupportedToken(
        L2BNBOnBobaEth.address,
        chainIdBobaBnb,
        defaultMinDepositAmount,
        defaultMaxDepositAmount,
        defaultMaxTransferPerDay
      )
      await LightBridge.addSupportedToken(
        L2BOBA.address,
        chainIdBobaBnb,
        defaultMinDepositAmount,
        defaultMaxDepositAmount,
        defaultMaxTransferPerDay
      )

      console.log(
        `Teleportation on ETH: ${LightBridge.address} / on BNB: ${LightBridgeBNB.address}`
      )

      // mock BNB network & overwrite prev network
      selectedBobaChains = [
        {
          chainId: chainIdBobaBnb,
          url: providerBnbUrl,
          provider: providerBnb,
          testnet: true,
          name: 'localhost:bnb',
          teleportationAddress: LightBridgeBNB.address,
          height: 0,
          supportedAssets: {
            [L2BNBOnBobaBnb.address?.toLowerCase()]: Asset.BNB,
            [ethers.constants.AddressZero]: Asset.BOBA,
          },
          airdropConfig: { ...airdropConfig, airdropEnabled: false },
          layer: EAirdropSource.ALLOW,
        },
      ]
      selectedBobaChainsBnb = [
        {
          chainId,
          url: providerUrl,
          provider: provider,
          testnet: true,
          name: 'localhost',
          teleportationAddress: LightBridge.address,
          height: 0,
          supportedAssets: {
            [L2BOBA.address?.toLowerCase()]: Asset.BOBA,
            [ethers.constants.AddressZero]: Asset.ETH,
            [L2BNBOnBobaEth.address?.toLowerCase()]: Asset.BNB,
          },
          airdropConfig: { ...airdropConfig, airdropEnabled: false },
          layer: EAirdropSource.ALLOW,
        },
      ]
    })

    it('should not airdrop if sourceChain is not a L1', async () => {
      const teleportationServiceBnb = await startLightBridgeService(
        true,
        null,
        null,
        providerBnb
      )
      await teleportationServiceBnb.init()

      // deposit token
      const bridgedAmount = utils.parseEther('50')
      const preBlockNumber = await providerBnb.getBlockNumber()
      await L2BNBOnBobaBnb.connect(signerBnb).approve(
        LightBridgeBNB.address,
        bridgedAmount
      )
      const res = await LightBridgeBNB.connect(signerBnb).teleportAsset(
        L2BNBOnBobaBnb.address,
        bridgedAmount,
        chainId // toChainId
      )
      await res.wait()
      await waitForSubgraph()

      const blockNumber = await providerBnb.getBlockNumber()
      const events = await teleportationServiceBnb._getAssetReceivedEvents(
        chainIdBobaBnb,
        chainId,
        preBlockNumber,
        blockNumber
      )

      console.log('Teleportation: ', LightBridgeBNB.address)
      expect(events.length).to.be.gt(0, 'Event length must be greater than 0')

      const teleportationServiceEth = await startLightBridgeService(
        false,
        true,
        EAirdropSource.PROHIBIT
      )
      await teleportationServiceEth.init()

      // random address to ensure balance = 0 to be eligible for airdrop
      const randAddress = ethers.Wallet.createRandom().address

      const lastEvent = events[events.length - 1]
      const sourceChainId = lastEvent.sourceChainId
      const depositId = lastEvent.depositId
      const amount = lastEvent.amount
      const token = lastEvent.token
      const emitter = lastEvent.emitter

      const receivingChainTokenAddr =
        teleportationServiceEth._getSupportedDestChainTokenAddrBySourceChainTokenAddr(
          token,
          sourceChainId
        )
      expect(receivingChainTokenAddr).to.be.eq(
        L2BNBOnBobaEth.address?.toLowerCase(),
        'BNB token address on BNB not correctly routed'
      )

      let disbursement = [
        {
          token: receivingChainTokenAddr,
          amount: amount.toString(),
          addr: randAddress,
          depositId: parseInt(depositId.toString()),
          sourceChainId: sourceChainId.toString(),
        },
      ]

      console.log('Added disbursement: ', disbursement)

      disbursement = orderBy(disbursement, ['depositId'], ['asc'])

      const preNativeBalance = await provider.getBalance(address1)
      const preSignerNativeBalance = await provider.getBalance(randAddress)
      const preTokenBalance = await L2BNBOnBobaBnb.balanceOf(address1)
      const preSignerTokenBalance = await L2BNBOnBobaBnb.balanceOf(randAddress)

      await teleportationServiceEth._disburseTx(
        disbursement,
        chainId,
        blockNumber
      )

      const postNativeBalance = await provider.getBalance(address1)
      const postSignerNativeBalance = await provider.getBalance(randAddress)
      const postTokenBalance = await L2BNBOnBobaEth.balanceOf(address1)
      const postSignerTokenBalance = await L2BNBOnBobaEth.balanceOf(randAddress)

      expect(preTokenBalance.sub(postTokenBalance)).to.be.eq(bridgedAmount)
      expect(postSignerTokenBalance.sub(preSignerTokenBalance)).to.be.eq(
        bridgedAmount
      )
      const gasDelta = ethers.utils.parseEther('0.003')
      expect(preNativeBalance.sub(postNativeBalance)).to.be.closeTo(
        '0',
        gasDelta
      )
      expect(postSignerNativeBalance.sub(preSignerNativeBalance)).to.be.closeTo(
        '0',
        gasDelta
      )
    })
  })

  describe('airdrop cooldown', () => {
    before(async () => {
      Factory__Teleportation = new ethers.ContractFactory(
        LightBridgeJson.abi,
        LightBridgeJson.bytecode,
        wallet1
      )

      LightBridge = await Factory__Teleportation.deploy()
      await LightBridge.deployTransaction.wait()

      Factory__L2BOBA = new ethers.ContractFactory(
        L1ERC20Json.abi,
        L1ERC20Json.bytecode,
        signer
      )
      L2BOBA = await Factory__L2BOBA.deploy(
        utils.parseEther('100000000000'),
        'BOBA',
        'BOBA',
        18
      )
      await L2BOBA.deployTransaction.wait()
      await L2BOBA.transfer(address1, utils.parseEther('100000000'))

      // intialize the teleportation contract
      await LightBridge.initialize()

      LightBridgeBNB = await Factory__Teleportation.connect(wallet1Bnb).deploy()
      await LightBridgeBNB.deployTransaction.wait()

      // deploy other token for routing tests
      L2BNBOnBobaBnb = await Factory__L2BOBA.connect(signerBnb).deploy(
        utils.parseEther('100000000000'),
        'BOBA',
        'BOBA',
        18
      )
      await L2BNBOnBobaBnb.deployTransaction.wait()
      await L2BNBOnBobaBnb.transfer(address1, utils.parseEther('100000000'))

      // deploy other token for routing tests
      L2BNBOnBobaEth = await Factory__L2BOBA.deploy(
        utils.parseEther('100000000000'),
        'BNB',
        'BNB',
        18
      )
      await L2BNBOnBobaEth.deployTransaction.wait()
      await L2BNBOnBobaEth.transfer(address1, utils.parseEther('100000000'))

      // intialize the teleportation contract
      await LightBridgeBNB.initialize()

      // add the supported chain & token
      await LightBridgeBNB.addSupportedToken(
        L2BNBOnBobaBnb.address,
        chainId,
        defaultMinDepositAmount,
        defaultMaxDepositAmount,
        defaultMaxTransferPerDay
      )
      await LightBridgeBNB.addSupportedToken(
        ethers.constants.AddressZero,
        chainId,
        defaultMinDepositAmount,
        defaultMaxDepositAmount,
        defaultMaxTransferPerDay
      )

      // add support on previous network
      await LightBridge.addSupportedToken(
        L2BNBOnBobaEth.address,
        chainIdBobaBnb,
        defaultMinDepositAmount,
        defaultMaxDepositAmount,
        defaultMaxTransferPerDay
      )
      await LightBridge.addSupportedToken(
        L2BOBA.address,
        chainIdBobaBnb,
        defaultMinDepositAmount,
        defaultMaxDepositAmount,
        defaultMaxTransferPerDay
      )

      console.log(
        `Teleportation on ETH: ${LightBridge.address} / on BNB: ${LightBridgeBNB.address}`
      )

      // mock BNB network & overwrite prev network
      selectedBobaChains = [
        {
          chainId: chainIdBobaBnb,
          url: providerBnbUrl,
          provider: providerBnb,
          testnet: true,
          name: 'localhost:bnb',
          teleportationAddress: LightBridgeBNB.address,
          height: 0,
          supportedAssets: {
            [L2BNBOnBobaBnb.address?.toLowerCase()]: Asset.BNB,
            [ethers.constants.AddressZero]: Asset.BOBA, // simulate BNB for native to token teleport
          },
          airdropConfig: { ...airdropConfig, airdropEnabled: false },
          layer: EAirdropSource.ALLOW,
        },
      ]
      selectedBobaChainsBnb = [
        {
          chainId,
          url: providerUrl,
          provider: provider,
          testnet: true,
          name: 'localhost',
          teleportationAddress: LightBridge.address,
          height: 0,
          supportedAssets: {
            [L2BOBA.address?.toLowerCase()]: Asset.BOBA,
            [ethers.constants.AddressZero]: Asset.ETH,
            [L2BNBOnBobaEth.address?.toLowerCase()]: Asset.BNB,
          },
          airdropConfig: { ...airdropConfig, airdropEnabled: false },
          layer: EAirdropSource.ALLOW,
        },
      ]
    })

    it('should not airdrop within cooldown period', async () => {
      const teleportationServiceBnb = await startLightBridgeService(
        true,
        null,
        null,
        providerBnb
      )
      await teleportationServiceBnb.init()

      // deposit token
      const preBlockNumber = await providerBnb.getBlockNumber()
      await L2BNBOnBobaBnb.connect(signerBnb).approve(
        LightBridgeBNB.address,
        utils.parseEther('20')
      )
      console.log('Cooldown: Teleporting')
      const res = await LightBridgeBNB.connect(signerBnb).teleportAsset(
        L2BNBOnBobaBnb.address,
        utils.parseEther('10'),
        chainId // toChainId
      )
      await res.wait()
      await waitForSubgraph()

      const blockNumber = await providerBnb.getBlockNumber()
      const events = await teleportationServiceBnb._getAssetReceivedEvents(
        chainIdBobaBnb,
        chainId,
        preBlockNumber,
        blockNumber
      )

      console.log('Teleportation: ', LightBridgeBNB.address)
      console.log('events.length', events.length)
      expect(events.length).to.be.gt(0, 'Event length must be greater than 0')

      const teleportationServiceEth = await startLightBridgeService(false, true)
      await teleportationServiceEth.init()

      const lastEvent = events[events.length - 1]
      const randWallet = ethers.Wallet.createRandom().connect(
        LightBridge.provider
      )
      const randAddress = randWallet.address
      const sourceChainId = lastEvent.sourceChainId
      const depositId = lastEvent.depositId
      const amount = lastEvent.amount
      const token = lastEvent.token
      const emitter = lastEvent.emitter

      const receivingChainTokenAddr =
        teleportationServiceEth._getSupportedDestChainTokenAddrBySourceChainTokenAddr(
          token,
          sourceChainId
        )
      expect(receivingChainTokenAddr).to.be.eq(
        L2BNBOnBobaEth.address?.toLowerCase(),
        'BNB token address on BNB not correctly routed'
      )

      let disbursement = [
        {
          token: receivingChainTokenAddr,
          amount: amount.toString(),
          addr: randAddress,
          depositId: parseInt(depositId.toString()),
          sourceChainId: sourceChainId.toString(),
        },
      ]

      console.log('Added disbursements: ', disbursement)

      disbursement = orderBy(disbursement, ['depositId'], ['asc'])

      const preNativeBalance = await provider.getBalance(address1)
      const preSignerNativeBalance = await provider.getBalance(randAddress)
      const preTokenBalance = await L2BNBOnBobaEth.balanceOf(address1)
      const preSignerTokenBalance = await L2BNBOnBobaEth.balanceOf(randAddress)

      console.log('Cooldown: Disbursing')
      await teleportationServiceEth._disburseTx(
        disbursement,
        chainId,
        blockNumber
      )

      console.log('Cooldown: Teleporting 2')
      // disburse again to trigger cooldown period
      await LightBridgeBNB.connect(signerBnb).teleportAsset(
        L2BNBOnBobaBnb.address,
        utils.parseEther('10'),
        chainId // toChainId
      )
      await waitForSubgraph()
      disbursement[0].depositId += 1
      console.log('Cooldown: Disbursing 2')
      await teleportationServiceEth._disburseTx(
        disbursement,
        chainId,
        blockNumber
      )

      const postNativeBalance = await provider.getBalance(address1)
      const postSignerNativeBalance = await provider.getBalance(randAddress)
      const postTokenBalance = await L2BNBOnBobaEth.balanceOf(address1)
      const postSignerTokenBalance = await L2BNBOnBobaEth.balanceOf(randAddress)

      expect(preTokenBalance.sub(postTokenBalance)).to.be.eq(
        utils.parseEther('20')
      )
      expect(postSignerTokenBalance.sub(preSignerTokenBalance)).to.be.eq(
        utils.parseEther('20')
      )
      const gasDelta = ethers.utils.parseEther('0.003')
      expect(preNativeBalance.sub(postNativeBalance)).to.be.closeTo(
        airdropConfig.airdropAmountWei,
        gasDelta
      )
      expect(postSignerNativeBalance.sub(preSignerNativeBalance)).to.be.eq(
        airdropConfig.airdropAmountWei
      )
    })
  })

  describe('query filter fallback', () => {
    before(async () => {
      Factory__Teleportation = new ethers.ContractFactory(
        LightBridgeJson.abi,
        LightBridgeJson.bytecode,
        wallet1
      )

      LightBridge = await Factory__Teleportation.deploy()
      await LightBridge.deployTransaction.wait()

      Factory__L2BOBA = new ethers.ContractFactory(
        L1ERC20Json.abi,
        L1ERC20Json.bytecode,
        signer
      )
      L2BOBA = await Factory__L2BOBA.deploy(
        utils.parseEther('100000000000'),
        'BOBA',
        'BOBA',
        18
      )
      await L2BOBA.deployTransaction.wait()
      await L2BOBA.transfer(address1, utils.parseEther('100000000'))

      // intialize the teleportation contract
      await LightBridge.initialize()

      LightBridgeBNB = await Factory__Teleportation.connect(wallet1Bnb).deploy()
      await LightBridgeBNB.deployTransaction.wait()

      // deploy other token for routing tests
      L2BNBOnBobaBnb = await Factory__L2BOBA.connect(signerBnb).deploy(
        utils.parseEther('100000000000'),
        'BOBA',
        'BOBA',
        18
      )
      await L2BNBOnBobaBnb.deployTransaction.wait()
      await L2BNBOnBobaBnb.transfer(address1, utils.parseEther('100000000'))

      // deploy other token for routing tests
      L2BNBOnBobaEth = await Factory__L2BOBA.deploy(
        utils.parseEther('100000000000'),
        'BNB',
        'BNB',
        18
      )
      await L2BNBOnBobaEth.deployTransaction.wait()
      await L2BNBOnBobaEth.transfer(address1, utils.parseEther('100000000'))

      // intialize the teleportation contract
      await LightBridgeBNB.initialize()

      // add the supported chain & token
      await LightBridgeBNB.addSupportedToken(
        L2BNBOnBobaBnb.address,
        chainId,
        defaultMinDepositAmount,
        defaultMaxDepositAmount,
        defaultMaxTransferPerDay
      )
      await LightBridgeBNB.addSupportedToken(
        ethers.constants.AddressZero,
        chainId,
        defaultMinDepositAmount,
        defaultMaxDepositAmount,
        defaultMaxTransferPerDay
      )

      // add support on previous network
      await LightBridge.addSupportedToken(
        L2BNBOnBobaEth.address,
        chainIdBobaBnb,
        defaultMinDepositAmount,
        defaultMaxDepositAmount,
        defaultMaxTransferPerDay
      )
      await LightBridge.addSupportedToken(
        L2BOBA.address,
        chainIdBobaBnb,
        defaultMinDepositAmount,
        defaultMaxDepositAmount,
        defaultMaxTransferPerDay
      )

      // NO NEED TO ADD THIS CONTRACT TO THE LOCAL GRAPH NODE, as we are using the queryfilter method/fallback here

      // mock BNB network & overwrite prev network
      selectedBobaChains = [
        {
          chainId: chainIdBobaBnb,
          url: providerBnbUrl,
          provider: providerBnb,
          testnet: true,
          name: 'localhost:bnb',
          teleportationAddress: LightBridgeBNB.address,
          height: 0,
          supportedAssets: {
            [L2BNBOnBobaBnb.address?.toLowerCase()]: Asset.BNB,
            [ethers.constants.AddressZero]: Asset.BOBA, // simulate BNB for native to token teleport
          },
          airdropConfig: { ...airdropConfig, airdropEnabled: false },
          layer: EAirdropSource.ALLOW,
        },
      ]
      selectedBobaChainsBnb = [
        {
          chainId,
          url: providerUrl,
          provider: provider,
          testnet: true,
          name: 'localhost',
          teleportationAddress: LightBridge.address,
          height: 0,
          supportedAssets: {
            [L2BOBA.address?.toLowerCase()]: Asset.BOBA,
            [ethers.constants.AddressZero]: Asset.ETH,
            [L2BNBOnBobaEth.address?.toLowerCase()]: Asset.BNB,
          },
          airdropConfig: { ...airdropConfig, airdropEnabled: false },
          layer: EAirdropSource.ALLOW,
        },
      ]
    })

    it('use queryfilter to get events instead of graphql', async () => {
      const teleportationServiceBnb = await startLightBridgeService(
        true,
        null,
        null,
        providerBnb
      )
      await teleportationServiceBnb.init()

      // deposit token
      const preBlockNumber = await providerBnb.getBlockNumber()
      await L2BNBOnBobaBnb.connect(signerBnb).approve(
        LightBridgeBNB.address,
        utils.parseEther('20')
      )
      const res = await LightBridgeBNB.connect(signerBnb).teleportAsset(
        L2BNBOnBobaBnb.address,
        utils.parseEther('10'),
        chainId // toChainId
      )
      await res.wait()
      await waitForSubgraph()

      const blockNumber = await providerBnb.getBlockNumber()
      const events =
        await teleportationServiceBnb._getAssetReceivedEventsViaQueryFilter(
          LightBridgeBNB,
          preBlockNumber,
          blockNumber
        )

      expect(events.length).to.be.gt(0, 'Event length must be greater than 0')

      const teleportationServiceEth = await startLightBridgeService(false, true)
      await teleportationServiceEth.init()

      const lastEvent = events[events.length - 1]
      const randWallet = ethers.Wallet.createRandom().connect(
        LightBridge.provider
      )
      const randAddress = randWallet.address
      const sourceChainId = lastEvent.sourceChainId
      const depositId = lastEvent.depositId
      const amount = lastEvent.amount
      const token = lastEvent.token

      const receivingChainTokenAddr =
        teleportationServiceEth._getSupportedDestChainTokenAddrBySourceChainTokenAddr(
          token,
          sourceChainId
        )
      expect(receivingChainTokenAddr).to.be.eq(
        L2BNBOnBobaEth.address?.toLowerCase(),
        'BNB token address on BNB not correctly routed'
      )

      let disbursement = [
        {
          token: receivingChainTokenAddr,
          amount: amount.toString(),
          addr: randAddress,
          depositId: parseInt(depositId.toString()),
          sourceChainId: sourceChainId.toString(),
        },
      ]

      console.log('Added disbursements: ', disbursement)

      disbursement = orderBy(disbursement, ['depositId'], ['asc'])

      const preNativeBalance = await provider.getBalance(address1)
      const preSignerNativeBalance = await provider.getBalance(randAddress)
      const preTokenBalance = await L2BNBOnBobaEth.balanceOf(address1)
      const preSignerTokenBalance = await L2BNBOnBobaEth.balanceOf(randAddress)

      await teleportationServiceEth._disburseTx(
        disbursement,
        chainId,
        blockNumber
      )

      // disburse again to trigger cooldown period
      await LightBridgeBNB.connect(signerBnb).teleportAsset(
        L2BNBOnBobaBnb.address,
        utils.parseEther('10'),
        chainId // toChainId
      )
      disbursement[0].depositId += 1
      await teleportationServiceEth._disburseTx(
        disbursement,
        chainId,
        blockNumber
      )

      const postNativeBalance = await provider.getBalance(address1)
      const postSignerNativeBalance = await provider.getBalance(randAddress)
      const postTokenBalance = await L2BNBOnBobaEth.balanceOf(address1)
      const postSignerTokenBalance = await L2BNBOnBobaEth.balanceOf(randAddress)

      expect(preTokenBalance.sub(postTokenBalance)).to.be.eq(
        utils.parseEther('20')
      )
      expect(postSignerTokenBalance.sub(preSignerTokenBalance)).to.be.eq(
        utils.parseEther('20')
      )
      const gasDelta = ethers.utils.parseEther('0.003')
      expect(preNativeBalance.sub(postNativeBalance)).to.be.closeTo(
        airdropConfig.airdropAmountWei,
        gasDelta
      )
      expect(postSignerNativeBalance.sub(preSignerNativeBalance)).to.be.eq(
        airdropConfig.airdropAmountWei
      )
    })
  })
})

describe.skip('service startup unit tests', () => {
  const createTestnetLightBridgeService = async () => {
    const chainIdToUse = 28882
    const networksToWatch = selectedNetworkFilter(chainIdToUse)
    const lbService = new LightBridgeService({
      // sometimes the same network with a different chain id is used
      l2RpcProvider: new providers.JsonRpcProvider({
        url: 'https://boba-sepolia.gateway.tenderly.co/1clfZoq7qEGyF4SQvF8gvI',
      }),
      chainId: chainIdToUse,
      lightBridgeAddress: BobaChains[chainIdToUse].teleportationAddress,
      selectedBobaChains: networksToWatch.selectedBobaChains,
      ownSupportedAssets: networksToWatch.originSupportedAssets,
      pollingInterval: 1000,
      blockRangePerPolling: 1000,
      awsConfig: {
        // Default values for local kms endpoint
        awsKmsAccessKey: process.env.LIGHTBRIDGE_AWS_KMS_ACCESS_KEY ?? '1',
        awsKmsSecretKey: process.env.LIGHTBRIDGE_AWS_KMS_SECRET_KEY ?? '2',
        awsKmsKeyId:
          process.env.LIGHTBRIDGE_AWS_KMS_KEY_ID ?? 'lb_disburser_pk',
        awsKmsEndpoint:
          process.env.LIGHTBRIDGE_AWS_KMS_ENDPOINT ?? 'http://kms:8888/',
        awsKmsRegion: process.env.LIGHTBRIDGE_AWS_KMS_REGION ?? 'us-east-1',
        disableDisburserCheck: true,
      },
      airdropConfig: {
        ...airdropConfig,
        airdropEnabled: false,
      },
    })
    await lbService.init()
    return lbService
  }

  it('should watch correct networks for Boba Eth Testnet', async () => {
    const lbService = await createTestnetLightBridgeService()

    expect(
      lbService.state.depositTeleportations.find(
        (c) => c.chainId.toString() === '11155420'
      )
    ).to.not.be.undefined
    expect(
      lbService.state.depositTeleportations.find(
        (c) => c.chainId.toString() === '421614'
      )
    ).to.not.be.undefined

    const arbDepositTeleportation = lbService.state.depositTeleportations.find(
      (c) => c.chainId.toString() === '421614'
    )
    const opDepositTeleportation = lbService.state.depositTeleportations.find(
      (c) => c.chainId.toString() === '11155420'
    )
    expect(await arbDepositTeleportation.Teleportation.totalDeposits('28882'))
      .to.not.be.undefined
    expect(await opDepositTeleportation.Teleportation.totalDeposits('28882')).to
      .not.be.undefined
  })
})
