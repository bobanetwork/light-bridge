import { expect } from './setup'

/* External Imports */
import { ethers, network } from 'hardhat'
import {
  BigNumber,
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

/* Imports: Interface */
import { ChainInfo, EAirdropSource } from '../src'

/* Imports: Core */
import { LightBridgeService } from '../src'
import { AppDataSource, historyDataRepository } from '../src/data-source'
import { Asset } from '../src'
import dotenv from 'dotenv'
import main from '../src/exec/run'
import { delay } from '../src/utils/misc.utils'

dotenv.config()

describe('lightbridge', () => {
  let providerUrl: string
  let provider: providers.JsonRpcProvider
  let signer: Signer
  let signerAddr: string

  let wallet1: Wallet
  let address1: string

  let selectedBobaChains: ChainInfo[]
  let selectedBobaChainsBnb: ChainInfo[]
  const pollingInterval: number = 1000
  const blockRangePerPolling = 1000

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

    providerUrl = process.env.RPC_URL ?? 'http://anvil_eth:8545'
    provider = new providers.JsonRpcProvider(providerUrl)
    console.warn('Using provider: ', providerUrl)

    await provider.send('evm_snapshot', [])

    // must be the same as for AWS KMS (see kms-seed.yml)
    signer = new Wallet(
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
      provider
    ) // PK used by anvil (public anyway)
    signerAddr = await signer.getAddress()
    wallet1 = new Wallet(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      provider
    ) // PK used by anvil (public anyway)
    address1 = wallet1.address

    await signer.sendTransaction({
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

  // Here to have an easy way to modify globally
  const airdropConfig = {
    airdropAmountWei: ethers.utils.parseEther('1'),
    airdropCooldownSeconds: 1000,
  }

  before(async () => {
    chainId = (await provider.getNetwork()).chainId
    chainIdBobaBnb = chainId + 1

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
    sourceLayerOverride?: EAirdropSource
  ) => {
    const chainIdToUse = useBnb ? chainIdBobaBnb : chainId
    const overridenBobaChains = (
      useBnb ? selectedBobaChainsBnb : selectedBobaChains
    ).map((c) => {
      c.layer = sourceLayerOverride ?? c.layer
      return c
    })

    return new LightBridgeService({
      l2RpcProvider: provider,
      chainId: chainIdToUse,
      teleportationAddress: useBnb
        ? LightBridgeBNB.address
        : LightBridge.address,
      selectedBobaChains: overridenBobaChains,
      // only defined one other for the routing tests (so idx 0 = own origin network)
      ownSupportedAssets: useBnb
        ? selectedBobaChains[0].supportedAssets
        : selectedBobaChainsBnb[0].supportedAssets,
      pollingInterval,
      blockRangePerPolling,
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

  it('should create LightBridgeService', async () => {
    const teleportationService = await startLightBridgeService()
    await teleportationService.init()
  })

  describe('unit function tests', () => {
    it('should get an event from LightBridge contract', async () => {
      const teleportationService = await startLightBridgeService()
      await teleportationService.init()

      const blockNumber = await provider.getBlockNumber()

      const events = await teleportationService._getEvents(
        LightBridge,
        LightBridge.filters.AssetReceived(),
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

      const latestBlockNumber = await provider.getBlockNumber()
      const latestEvents = await teleportationService._getEvents(
        LightBridge,
        LightBridge.filters.AssetReceived(),
        0,
        latestBlockNumber
      )

      expect(latestEvents.length).to.be.eq(1)
      expect(latestEvents[0].args.sourceChainId).to.be.eq(chainId)
      expect(latestEvents[0].args.toChainId).to.be.eq(chainId)
      expect(latestEvents[0].args.depositId).to.be.eq(0)
      expect(latestEvents[0].args.emitter).to.be.eq(signerAddr)
      expect(latestEvents[0].args.amount).to.be.eq(utils.parseEther('10'))
    })

    it('should send a disbursement TX for a single event', async () => {
      const teleportationService = await startLightBridgeService()
      await teleportationService.init()

      const blockNumber = await provider.getBlockNumber()
      const events = await teleportationService._getEvents(
        LightBridge,
        LightBridge.filters.AssetReceived(),
        0,
        blockNumber
      )

      expect(events.length).to.be.gt(0, 'Event length must be greater than 0')

      let disbursement = []
      for (const event of events) {
        const sourceChainId = event.args.sourceChainId
        const depositId = event.args.depositId
        const amount = event.args.amount
        const token = event.args.token
        const emitter = event.args.emitter

        disbursement = [
          ...disbursement,
          {
            token,
            amount: amount.toString(),
            addr: emitter,
            depositId: depositId.toNumber(),
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
      const events = await teleportationService._getEvents(
        LightBridge,
        LightBridge.filters.AssetReceived(),
        0,
        blockNumber
      )

      let disbursement = []
      for (const event of events) {
        const sourceChainId = event.args.sourceChainId
        const depositId = event.args.depositId
        const amount = event.args.amount
        const emitter = event.args.emitter
        const token = event.args.token

        disbursement = [
          ...disbursement,
          {
            token,
            amount: amount.toString(),
            addr: emitter,
            depositId: depositId.toNumber(),
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
      for (let i = 0; i < 15; i++) {
        await L2BOBA.approve(LightBridge.address, utils.parseEther('10'))
        await LightBridge.connect(signer).teleportAsset(
          L2BOBA.address,
          utils.parseEther('10'),
          chainId
        )
      }

      const endBlockNumber = await provider.getBlockNumber()
      const latestEvents = await teleportationService._getEvents(
        LightBridge,
        LightBridge.filters.AssetReceived(),
        startBlockNumber,
        endBlockNumber
      )

      expect(latestEvents.length).to.be.eq(15)
    })

    it('should slice events into chunks and send disbursements', async () => {
      const teleportationService = await startLightBridgeService()
      await teleportationService.init()

      const blockNumber = await provider.getBlockNumber()
      const events = await teleportationService._getEvents(
        LightBridge,
        LightBridge.filters.AssetReceived(),
        0,
        blockNumber
      )
      const lastDisbursement = await LightBridge.totalDisbursements(chainId)

      let disbursement = []
      for (const event of events) {
        const token = event.args.token
        const sourceChainId = event.args.sourceChainId
        const depositId = event.args.depositId
        const amount = event.args.amount
        const emitter = event.args.emitter

        if (depositId.gte(lastDisbursement)) {
          disbursement = [
            ...disbursement,
            {
              token,
              amount: amount.toString(),
              addr: emitter,
              depositId: depositId.toNumber(),
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
      await LightBridge.connect(signer).teleportAsset(
        L2BOBA.address,
        utils.parseEther('11'),
        chainId
      )

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
      expect(events.length).to.be.eq(2)
      expect(events[1].args.token).to.be.eq(L2BOBA.address)
      expect(events[1].args.sourceChainId).to.be.eq(chainId)
      expect(events[1].args.toChainId).to.be.eq(chainId)
      expect(events[1].args.depositId).to.be.eq(16)
      expect(events[1].args.emitter).to.be.eq(signerAddr)
      expect(events[1].args.amount).to.be.eq(utils.parseEther('11'))
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
        await LightBridge.connect(signer).teleportAsset(
          L2BOBA.address,
          utils.parseEther('1'),
          chainId
        )
      }

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
      expect(events.length).to.be.eq(12)
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
      LightBridgeBNB = await Factory__Teleportation.deploy()
      await LightBridge.deployTransaction.wait()

      // deploy other token for routing tests
      L2BNBOnBobaBnb = await Factory__L2BOBA.deploy(
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
          url: providerUrl,
          provider: provider,
          testnet: true,
          name: 'localhost:bnb',
          teleportationAddress: LightBridgeBNB.address,
          height: 0,
          supportedAssets: {
            [L2BNBOnBobaBnb.address?.toLowerCase()]: Asset.BOBA,
            [ethers.constants.AddressZero?.toLowerCase()]: Asset.BNB, // simulate BNB for native to token teleport
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
            [ethers.constants.AddressZero?.toLowerCase()]: Asset.ETH,
            [L2BNBOnBobaEth.address?.toLowerCase()]: Asset.BNB,
          },
          airdropConfig: { ...airdropConfig, airdropEnabled: false },
          layer: EAirdropSource.ALLOW,
        },
      ]
    })

    it('teleport BOBA as token from chain A (e.g. BNB) to chain B (ETH)', async () => {
      const teleportationServiceBnb = await startLightBridgeService(true)
      await teleportationServiceBnb.init()

      // deposit token
      const preBlockNumber = await provider.getBlockNumber()
      await L2BNBOnBobaBnb.connect(signer).approve(
        LightBridgeBNB.address,
        utils.parseEther('10')
      )
      await LightBridgeBNB.connect(signer).teleportAsset(
        L2BNBOnBobaBnb.address,
        utils.parseEther('10'),
        chainId // toChainId
      )

      const blockNumber = await provider.getBlockNumber()
      const events = await teleportationServiceBnb._getEvents(
        LightBridgeBNB,
        LightBridgeBNB.filters.AssetReceived(),
        preBlockNumber,
        blockNumber
      )

      expect(events.length).to.be.gt(0, 'Event length must be greater than 0')

      const teleportationServiceEth = await startLightBridgeService(false)
      await teleportationServiceEth.init()

      let disbursement = []
      for (const event of events) {
        const sourceChainId = chainIdBobaBnb // event.args.sourceChainId -> (is correct, but we were mocking a fake chainId for testing)
        const depositId = event.args.depositId
        const amount = event.args.amount
        const token = event.args.token
        const emitter = event.args.emitter

        const receivingChainTokenAddr =
          teleportationServiceEth._getSupportedDestChainTokenAddrBySourceChainTokenAddr(
            token,
            sourceChainId
          )
        expect(receivingChainTokenAddr.toLowerCase()).to.be.eq(
          L2BOBA.address.toLowerCase(),
          'BOBA token address on BNB not correctly routed'
        )

        disbursement = [
          ...disbursement,
          {
            token: receivingChainTokenAddr,
            amount: amount.toString(),
            addr: emitter,
            depositId: depositId.toNumber(),
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

    it('teleport BNB as native from chain B (e.g. BNB) to chain A (ETH) as wrapped token', async () => {
      const teleportationService = await startLightBridgeService(true)
      await teleportationService.init()

      // deposit token
      const preBlockNumber = await provider.getBlockNumber()
      await LightBridgeBNB.connect(signer).teleportAsset(
        ethers.constants.AddressZero, // send native BNB
        utils.parseEther('10'),
        chainId, // toChainId
        { value: utils.parseEther('10') }
      )

      const blockNumber = await provider.getBlockNumber()
      const events = await teleportationService._getEvents(
        LightBridgeBNB,
        LightBridgeBNB.filters.AssetReceived(),
        preBlockNumber,
        blockNumber+10
      )

      expect(events.length).to.be.gt(0, 'Event length must be greater than 0')

      const teleportationServiceEth = await startLightBridgeService(false)
      await teleportationServiceEth.init()

      let disbursement = []
      for (const event of events) {
        const sourceChainId = chainIdBobaBnb // event.args.sourceChainId -> (is correct, but we were mocking a fake chainId for testing)
        const depositId = event.args.depositId
        const amount = event.args.amount
        const token = event.args.token
        const emitter = event.args.emitter

        const receivingChainTokenAddr =
          teleportationServiceEth._getSupportedDestChainTokenAddrBySourceChainTokenAddr(
            token,
            sourceChainId
          )
        expect(receivingChainTokenAddr.toLowerCase()).to.be.eq(
          L2BNBOnBobaEth.address.toLowerCase(),
          'BNB token address on Boba ETH not correctly routed'
        )

        disbursement = [
          ...disbursement,
          {
            token: receivingChainTokenAddr,
            amount: amount.toString(),
            addr: emitter,
            depositId: depositId.toNumber(),
            sourceChainId: sourceChainId.toString(),
          },
        ]

        console.log('Added disbursement native: ', disbursement)
      }

      disbursement = orderBy(disbursement, ['depositId'], ['asc'])

      const preBNBBalance = await L2BNBOnBobaEth.balanceOf(address1)
      const preSignerBNBBalance = await L2BNBOnBobaEth.balanceOf(signerAddr)

      await teleportationServiceEth._disburseTx(
        disbursement,
        chainId,
        blockNumber
      )

      const postBNBBalance = await L2BNBOnBobaEth.balanceOf(address1)
      const postSignerBNBBalance = await L2BNBOnBobaEth.balanceOf(signerAddr)

      expect(preBNBBalance.sub(postBNBBalance)).to.be.eq(utils.parseEther('10'))
      expect(postSignerBNBBalance.sub(preSignerBNBBalance)).to.be.eq(
        utils.parseEther('10')
      )
    })

    it('teleport BNB as token from chain A (ETH) to chain B (e.g. BNB) as native asset', async () => {
      const teleportationService = await startLightBridgeService(false)
      await teleportationService.init()

      // deposit token
      const preBlockNumber = await provider.getBlockNumber()

      await L2BNBOnBobaEth.approve(LightBridge.address, utils.parseEther('10'))
      await LightBridge.connect(signer).teleportAsset(
        L2BNBOnBobaEth.address, // send BNB as token
        utils.parseEther('10'),
        chainIdBobaBnb // toChainId
      )

      const blockNumber = await provider.getBlockNumber()
      const events = await teleportationService._getEvents(
        LightBridge,
        LightBridge.filters.AssetReceived(),
        preBlockNumber,
        blockNumber
      )

      expect(events.length).to.be.gt(0, 'Event length must be greater than 0')

      const teleportationServiceBnb = await startLightBridgeService(true)
      await teleportationServiceBnb.init()

      let disbursement = []
      for (const event of events) {
        const sourceChainId = event.args.sourceChainId
        const depositId = await LightBridgeBNB.totalDisbursements(chainId) // event.args.depositId --> correct, but we used a fake chainId to simulate Bnb so we need to correct depositId here
        const amount = event.args.amount
        const token = event.args.token
        const emitter = event.args.emitter

        const receivingChainTokenAddr =
          teleportationServiceBnb._getSupportedDestChainTokenAddrBySourceChainTokenAddr(
            token,
            sourceChainId
          )
        expect(receivingChainTokenAddr).to.be.eq(
          ethers.constants.AddressZero,
          'BNB native asset on Boba BNB not correctly routed'
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

      LightBridgeBNB = await Factory__Teleportation.deploy()
      await LightBridge.deployTransaction.wait()

      // deploy other token for routing tests
      L2BNBOnBobaBnb = await Factory__L2BOBA.deploy(
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
          url: providerUrl,
          provider: provider,
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

    it('should not airdrop if sourceChain is not a L1', async () => {
      const teleportationServiceBnb = await startLightBridgeService(true)
      await teleportationServiceBnb.init()

      // deposit token
      const bridgedAmount = utils.parseEther('50')
      const preBlockNumber = await provider.getBlockNumber()
      await L2BNBOnBobaBnb.connect(signer).approve(
        LightBridgeBNB.address,
        bridgedAmount
      )
      await LightBridgeBNB.connect(signer).teleportAsset(
        L2BNBOnBobaBnb.address,
        bridgedAmount,
        chainId // toChainId
      )

      const blockNumber = await provider.getBlockNumber()
      const events = await teleportationServiceBnb._getEvents(
        LightBridgeBNB,
        LightBridgeBNB.filters.AssetReceived(),
        preBlockNumber,
        blockNumber
      )

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
      const sourceChainId = chainIdBobaBnb // event.args.sourceChainId -> (is correct, but we were mocking a fake chainId for testing)
      const depositId = lastEvent.args.depositId
      const amount = lastEvent.args.amount
      const token = lastEvent.args.token
      const emitter = lastEvent.args.emitter

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
          depositId: depositId.toNumber(),
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

    it('should not receive gas on airdrop when airdrop disabled (e.g. for L1)', async () => {
      const teleportationServiceBnb = await startLightBridgeService(true)
      await teleportationServiceBnb.init()

      // deposit token
      const preBlockNumber = await provider.getBlockNumber()
      await L2BNBOnBobaBnb.connect(signer).approve(
        LightBridgeBNB.address,
        utils.parseEther('10')
      )
      await LightBridgeBNB.connect(signer).teleportAsset(
        L2BNBOnBobaBnb.address,
        utils.parseEther('10'),
        chainId // toChainId
      )

      const blockNumber = await provider.getBlockNumber()
      const events = await teleportationServiceBnb._getEvents(
        LightBridgeBNB,
        LightBridgeBNB.filters.AssetReceived(),
        preBlockNumber,
        blockNumber
      )

      expect(events.length).to.be.gt(0, 'Event length must be greater than 0')

      const teleportationServiceEth = await startLightBridgeService(
        false,
        false
      )
      await teleportationServiceEth.init()

      // random address to ensure balance = 0 to be eligible for airdrop
      const randAddress = ethers.Wallet.createRandom().address

      const lastEvent = events[events.length - 1]
      const sourceChainId = chainIdBobaBnb // event.args.sourceChainId -> (is correct, but we were mocking a fake chainId for testing)
      const depositId = lastEvent.args.depositId
      const amount = lastEvent.args.amount
      const token = lastEvent.args.token
      const emitter = lastEvent.args.emitter

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
          depositId: depositId.toNumber(),
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

    it('should not airdrop if user has gas on destination network', async () => {
      const teleportationServiceBnb = await startLightBridgeService(true)
      await teleportationServiceBnb.init()

      // deposit token
      const preBlockNumber = await provider.getBlockNumber()
      await L2BNBOnBobaBnb.connect(signer).approve(
        LightBridgeBNB.address,
        utils.parseEther('10')
      )
      await LightBridgeBNB.connect(signer).teleportAsset(
        L2BNBOnBobaBnb.address,
        utils.parseEther('10'),
        chainId // toChainId
      )

      const blockNumber = await provider.getBlockNumber()
      const events = await teleportationServiceBnb._getEvents(
        LightBridgeBNB,
        LightBridgeBNB.filters.AssetReceived(),
        preBlockNumber,
        blockNumber
      )

      expect(events.length).to.be.gt(0, 'Event length must be greater than 0')

      const teleportationServiceEth = await startLightBridgeService(false, true)
      await teleportationServiceEth.init()

      const lastEvent = events[events.length - 1]
      const sourceChainId = chainIdBobaBnb // event.args.sourceChainId -> (is correct, but we were mocking a fake chainId for testing)
      const depositId = lastEvent.args.depositId
      const amount = lastEvent.args.amount
      const token = lastEvent.args.token
      const emitter = lastEvent.args.emitter

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
          depositId: depositId.toNumber(),
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

    it('should not airdrop if user bridges asset that is native on destination network', async () => {
      const teleportationServiceETH = await startLightBridgeService(false)
      await teleportationServiceETH.init()

      // deposit token
      const amountToBridge = utils.parseEther('10')
      const preBlockNumber = await provider.getBlockNumber()
      await L2BOBA.connect(signer).approve(LightBridge.address, amountToBridge)
      await LightBridge.connect(signer).teleportAsset(
        L2BOBA.address,
        amountToBridge,
        chainIdBobaBnb // toChainId
      )

      const blockNumber = await provider.getBlockNumber()
      const events = await teleportationServiceETH._getEvents(
        LightBridge,
        LightBridge.filters.AssetReceived(),
        preBlockNumber,
        blockNumber
      )

      expect(events.length).to.be.gt(0, 'Event length must be greater than 0')

      const teleportationServiceBnb = await startLightBridgeService(true, true)
      await teleportationServiceBnb.init()

      // random address to ensure balance = 0 to be eligible for airdrop
      const randAddress = ethers.Wallet.createRandom().address
      const lastEvent = events[events.length - 1]
      const sourceChainId = lastEvent.args.sourceChainId
      const depositId = lastEvent.args.depositId
      const amount = lastEvent.args.amount
      const token = lastEvent.args.token
      const emitter = lastEvent.args.emitter

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
          depositId: depositId.toNumber(),
          sourceChainId: sourceChainId.toString(),
        },
      ]

      console.log('Added disbursement: ', disbursement)

      disbursement = orderBy(disbursement, ['depositId'], ['asc'])

      const preNativeBalance = await provider.getBalance(address1)
      const preSignerNativeBalance = await provider.getBalance(randAddress)

      await teleportationServiceBnb._disburseTx(
        disbursement,
        chainId,
        blockNumber
      )

      const postNativeBalance = await provider.getBalance(address1)
      const postSignerNativeBalance = await provider.getBalance(randAddress)

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

  describe('airdrop', () => {
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

      LightBridgeBNB = await Factory__Teleportation.deploy()
      await LightBridge.deployTransaction.wait()

      // deploy other token for routing tests
      L2BNBOnBobaBnb = await Factory__L2BOBA.deploy(
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
          url: providerUrl,
          provider: provider,
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

    it('receive gas on airdrop', async () => {
      const teleportationServiceBnb = await startLightBridgeService(true)
      await teleportationServiceBnb.init()

      // deposit token
      const preBlockNumber = await provider.getBlockNumber()
      await L2BNBOnBobaBnb.connect(signer).approve(
        LightBridgeBNB.address,
        utils.parseEther('10')
      )
      await LightBridgeBNB.connect(signer).teleportAsset(
        L2BNBOnBobaBnb.address,
        utils.parseEther('10'),
        chainId // toChainId
      )

      const blockNumber = await provider.getBlockNumber()
      const events = await teleportationServiceBnb._getEvents(
        LightBridgeBNB,
        LightBridgeBNB.filters.AssetReceived(),
        preBlockNumber,
        blockNumber
      )

      expect(events.length).to.be.gt(0, 'Event length must be greater than 0')

      const teleportationServiceEth = await startLightBridgeService(false, true)
      await teleportationServiceEth.init()

      // random address to ensure balance = 0 to be eligible for airdrop
      const randAddress = ethers.Wallet.createRandom().address

      const lastEvent = events[events.length - 1]
      const sourceChainId = chainIdBobaBnb // event.args.sourceChainId -> (is correct, but we were mocking a fake chainId for testing)
      const depositId = lastEvent.args.depositId
      const amount = lastEvent.args.amount
      const token = lastEvent.args.token
      const emitter = lastEvent.args.emitter

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
          depositId: depositId.toNumber(),
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

      expect(preTokenBalance.sub(postTokenBalance)).to.be.eq(
        utils.parseEther('10')
      )
      expect(postSignerTokenBalance.sub(preSignerTokenBalance)).to.be.eq(
        utils.parseEther('10')
      )
      const gasDelta = ethers.utils.parseEther('0.003')
      expect(preNativeBalance.sub(postNativeBalance)).to.be.closeTo(
        airdropConfig.airdropAmountWei,
        gasDelta
      )
      expect(postSignerNativeBalance.sub(preSignerNativeBalance)).to.be.closeTo(
        airdropConfig.airdropAmountWei,
        gasDelta
      )
    })

    it('should not airdrop within cooldown period', async () => {
      const teleportationServiceBnb = await startLightBridgeService(true)
      await teleportationServiceBnb.init()

      // deposit token
      const preBlockNumber = await provider.getBlockNumber()
      await L2BNBOnBobaBnb.connect(signer).approve(
        LightBridgeBNB.address,
        utils.parseEther('20')
      )
      await LightBridgeBNB.connect(signer).teleportAsset(
        L2BNBOnBobaBnb.address,
        utils.parseEther('10'),
        chainId // toChainId
      )

      const blockNumber = await provider.getBlockNumber()
      const events = await teleportationServiceBnb._getEvents(
        LightBridgeBNB,
        LightBridgeBNB.filters.AssetReceived(),
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
      const sourceChainId = chainIdBobaBnb // event.args.sourceChainId -> (is correct, but we were mocking a fake chainId for testing)
      const depositId = lastEvent.args.depositId
      const amount = lastEvent.args.amount
      const token = lastEvent.args.token
      const emitter = lastEvent.args.emitter

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
          depositId: depositId.toNumber(),
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
      await LightBridgeBNB.connect(signer).teleportAsset(
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

describe('lightbridge parallel', () => {
  let providerUrl: string
  let providerUrlBnb: string
  let provider: providers.JsonRpcProvider
  let providerBnb: providers.JsonRpcProvider
  let signer: Signer
  let signerBnb: Signer
  let signerAddr: string
  let signerAddrBnb: string

  let wallet1: Wallet
  let wallet1Bnb: Wallet
  let address1: string
  let address1Bnb: string

  let chainId: number
  let chainIdBnb: number

  let selectedBobaChains: ChainInfo[]

  const defaultMinDepositAmount = utils.parseEther('1')
  const defaultMaxDepositAmount = utils.parseEther('100')
  const defaultMaxTransferPerDay = utils.parseEther('100000')

  after(async () => {
    // reset blockchain state
    await provider.send('evm_revert', ['0x1'])
    await providerBnb.send('evm_revert', ['0x1'])
  })

  before(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize()
    } else {
      await AppDataSource.dropDatabase()
    }
    await AppDataSource.synchronize(true) // drops database and recreates

    providerUrl = 'http://anvil_eth:8545'
    provider = new providers.StaticJsonRpcProvider(providerUrl)

    providerUrlBnb = 'http://anvil_bnb:8545'
    providerBnb = new providers.StaticJsonRpcProvider(providerUrlBnb)

    await provider.send('evm_snapshot', [])
    await providerBnb.send('evm_snapshot', [])

    chainId = (await provider.getNetwork()).chainId
    chainIdBnb = (await providerBnb.getNetwork()).chainId

    signer = new Wallet(
      '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
      provider
    )
    signerAddr = await signer.getAddress()
    wallet1 = new Wallet(
      '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
      provider
    )
    address1 = wallet1.address

    signerBnb = signer.connect(providerBnb)
    signerAddrBnb = await signerBnb.getAddress()
    wallet1Bnb = wallet1.connect(providerBnb)
    address1Bnb = wallet1Bnb.address

    await signer.sendTransaction({
      to: wallet1.address,
      value: ethers.utils.parseEther('100'),
    })
    await signerBnb.sendTransaction({
      to: wallet1.address,
      value: ethers.utils.parseEther('100'),
    })
  })

  let Factory__Teleportation: ContractFactory
  let LightBridge: Contract
  let LightBridgeBNB: Contract

  let Factory__L2BOBA: ContractFactory
  let L2BOBA: Contract
  let L2BOBA_BNB: Contract
  let __LOCAL_NETWORKS: ChainInfo[]

  // Here to have an easy way to modify globally
  const airdropConfig = {
    airdropAmountWei: ethers.utils.parseEther('1'),
    airdropCooldownSeconds: 1000,
  }

  before(async () => {
    Factory__Teleportation = new ethers.ContractFactory(
      LightBridgeJson.abi,
      LightBridgeJson.bytecode,
      wallet1 // must be wallet1!
    )

    LightBridge = await Factory__Teleportation.deploy()
    await LightBridge.deployTransaction.wait()

    LightBridgeBNB = await Factory__Teleportation.connect(wallet1Bnb).deploy()
    await LightBridgeBNB.deployTransaction.wait()

    // intialize the teleportation contract
    await LightBridge.initialize()
    await LightBridgeBNB.initialize()

    // BOBA TOKEN ---
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

    // BOBA TOKEN BNB ---
    const Factory__L2BOBA_BNB = new ethers.ContractFactory(
      L1ERC20Json.abi,
      L1ERC20Json.bytecode,
      signerBnb
    )
    L2BOBA_BNB = await Factory__L2BOBA_BNB.deploy(
      utils.parseEther('100000000000'),
      'BOBA_BNB',
      'BOBA_BNB',
      18
    )
    await L2BOBA_BNB.deployTransaction.wait()
    await L2BOBA_BNB.transfer(address1Bnb, utils.parseEther('100000000'))

    await LightBridge.addSupportedToken(
      L2BOBA.address,
      chainIdBnb,
      defaultMinDepositAmount,
      defaultMaxDepositAmount,
      defaultMaxTransferPerDay
    )

    await LightBridge.addSupportedToken(
      ethers.constants.AddressZero,
      chainIdBnb,
      defaultMinDepositAmount,
      defaultMaxDepositAmount,
      defaultMaxTransferPerDay
    )

    await LightBridgeBNB.addSupportedToken(
      L2BOBA_BNB.address,
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

    // build payload
    selectedBobaChains = [
      {
        chainId,
        url: providerUrl,
        provider: null, // not serializable
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
      {
        chainId: chainIdBnb,
        url: providerUrlBnb,
        provider: null, // not serializable
        testnet: true,
        name: 'localhost:bnb',
        teleportationAddress: LightBridgeBNB.address,
        height: 0,
        supportedAssets: {
          [L2BOBA_BNB.address?.toLowerCase()]: Asset.BOBA,
          [ethers.constants.AddressZero?.toLowerCase()]: Asset.ETH,
        },
        airdropConfig: { ...airdropConfig, airdropEnabled: false },
        layer: EAirdropSource.ALLOW,
      },
      // bnb will be added in routing tests to have cleaner before hooks
    ]

    __LOCAL_NETWORKS = selectedBobaChains

    await startAllLightBridgeServices()
  })

  const startAllLightBridgeServices = async () => {
    process.env = {
      ...process.env,
      LIGHTBRIDGE_ENV: 'dev',
      LIGHTBRIDGE_AWS_KMS_ACCESS_KEY: '1',
      LIGHTBRIDGE_AWS_KMS_SECRET_KEY: '2',
      LIGHTBRIDGE_AWS_KMS_KEY_ID: 'lb_disburser_pk_2',
      LIGHTBRIDGE_AWS_KMS_ENDPOINT: 'http://kms:8888',
      LIGHTBRIDGE_AWS_KMS_REGION: 'us-east-1',
      __LOCAL_NETWORKS: JSON.stringify(__LOCAL_NETWORKS),
    }

    main().then((res) => console.log('--- main() DONE!')) // do not await as it would block tests
    await delay(8000)
  }

  it('should boot up anvil and test configuration correctly', async () => {
    // expect provider setup is correct
    expect(providerUrl).to.contain('eth')
    expect(providerUrlBnb).to.contain('bnb')
    expect((await provider.getNetwork()).chainId).to.be.eq(31337)
    expect(provider.connection.url).to.contain('eth')
    expect(providerBnb.connection.url).to.contain('bnb')
    expect((await providerBnb.getNetwork()).chainId).to.be.eq(31338)
    // expect disburse are correctly setup
    expect(await LightBridge.disburser()).to.eq(wallet1.address)
    expect(await LightBridgeBNB.disburser()).to.eq(wallet1Bnb.address)
  })

  it('should create the correct example chain data', async () => {
    // - 31337
    const chainIdUndertest = 31337
    const sutLocalhost = selectedBobaChains.find((s) => s.name === 'localhost')
    expect(sutLocalhost.chainId).to.eq(chainIdUndertest)
    expect(
      (await new providers.StaticJsonRpcProvider(sutLocalhost.url).getNetwork())
        .chainId
    ).to.eq(chainIdUndertest)
    expect(sutLocalhost.testnet).to.be.true
    const expectedAssets = [
      L2BOBA_BNB.address.toLowerCase(),
      ethers.constants.AddressZero.toLowerCase(),
    ]
    Object.keys(sutLocalhost.supportedAssets).forEach((key) => {
      expectedAssets.includes(key)
    })
    // - 31338
    const chainIdUndertest2 = 31338
    const sutLocalhostBnb = selectedBobaChains.find(
      (s) => s.name === 'localhost:bnb'
    )
    expect(sutLocalhostBnb.chainId).to.eq(chainIdUndertest2)
    expect(
      (
        await new providers.StaticJsonRpcProvider(
          sutLocalhostBnb.url
        ).getNetwork()
      ).chainId
    ).to.eq(chainIdUndertest2)
    expect(sutLocalhost.testnet).to.be.true
    const expectedBnbAssets = [
      L2BOBA.address?.toLowerCase(),
      ethers.constants.AddressZero.toLowerCase(),
    ]
    Object.keys(sutLocalhost.supportedAssets).forEach((key) => {
      expectedBnbAssets.includes(key)
    })
  })

  it('should add supported tokens', async () => {
    // supported true cases
    expect(
      (
        await LightBridge.supportedTokens(
          ethers.constants.AddressZero,
          chainIdBnb
        )
      )[0]
    ).to.be.true
    expect((await LightBridge.supportedTokens(L2BOBA.address, chainIdBnb))[0])
      .to.be.true
    expect(
      (
        await LightBridgeBNB.supportedTokens(
          ethers.constants.AddressZero,
          chainId
        )
      )[0]
    ).to.be.true
    expect(
      (await LightBridgeBNB.supportedTokens(L2BOBA_BNB.address, chainId))[0]
    ).to.be.true
    // supported false cases
    expect(
      (
        await LightBridgeBNB.supportedTokens(
          ethers.constants.AddressZero,
          chainId
        )
      )[0]
    ).to.be.true
    expect((await LightBridgeBNB.supportedTokens(L2BOBA.address, chainId))[0])
      .to.be.true
    expect(
      (
        await LightBridge.supportedTokens(
          ethers.constants.AddressZero,
          chainIdBnb
        )
      )[0]
    ).to.be.true
    expect(
      (await LightBridge.supportedTokens(L2BOBA_BNB.address, chainIdBnb))[0]
    ).to.be.true
  })

  it('should Bridge successfully', async () => {
    // deposit token
    const amount = utils.parseEther('5')
    const preBalanceBobaSigner = await L2BOBA.balanceOf(signerAddr)
    const preBalanceBobaSignerBNB = await L2BOBA_BNB.balanceOf(signerAddr)
    const preBalanceLightBridge = await L2BOBA.balanceOf(LightBridge.address)
    const preBalanceBobaDisburser = await L2BOBA_BNB.balanceOf(wallet1.address)

    await L2BOBA_BNB.approve(LightBridgeBNB.address, amount)
    expect(preBalanceLightBridge).to.be.eq(0)
    await L2BOBA.approve(LightBridge.address, amount)
    await LightBridge.connect(signer).teleportAsset(
      L2BOBA.address,
      amount,
      chainIdBnb
    )
    await delay(10_000)

    const postBalanceSigner = await L2BOBA.balanceOf(signerAddr)
    const postBalanceSignerBNB = await L2BOBA_BNB.balanceOf(signerAddr)
    const postBalanceDisburser = await L2BOBA_BNB.balanceOf(wallet1.address)
    const postBalanceLightBridge = await L2BOBA.balanceOf(LightBridge.address)

    expect(preBalanceBobaSigner).to.be.gt(postBalanceSigner)
    expect(preBalanceBobaDisburser).to.be.gt(postBalanceDisburser)
    expect(preBalanceBobaSignerBNB).to.be.lt(postBalanceSignerBNB)
    expect(preBalanceLightBridge).to.be.lt(postBalanceLightBridge)
  }).timeout(100_000)

  it('should should bridge back', async () => {
    // deposit token
    const amount = utils.parseEther('50')
    const preBalanceBobaSigner = await L2BOBA_BNB.balanceOf(signerAddrBnb)
    const preBalanceBobaDisburser = await L2BOBA.balanceOf(wallet1Bnb.address)

    await L2BOBA_BNB.approve(LightBridgeBNB.address, amount)
    await LightBridgeBNB.connect(signerBnb).teleportAsset(
      L2BOBA_BNB.address,
      amount,
      chainId
    )
    await delay(10_000)

    const postBalanceSigner = await L2BOBA_BNB.balanceOf(signerAddr)
    const postBalanceDisburser = await L2BOBA.balanceOf(wallet1Bnb.address)

    expect(preBalanceBobaSigner).to.be.gt(postBalanceSigner)
    expect(preBalanceBobaDisburser).to.be.gt(postBalanceDisburser)
  }).timeout(100_000)

  it('should contain a valid AssetReceived and DisbursementSuccess Event', async () => {
    // deposit token
    const amount = utils.parseEther('12')

    await L2BOBA_BNB.approve(LightBridgeBNB.address, amount)
    const bridgeTx = await LightBridgeBNB.connect(signerBnb).teleportAsset(
      L2BOBA_BNB.address,
      amount,
      chainId
    )
    const hashUnderTest = bridgeTx.hash

    await delay(20_000)

    const toBlock = 500 // NOTE: Increase this if it suddenly doesn't find events anymore
    const originEvents = await LightBridgeBNB.queryFilter(
      'AssetReceived',
      0,
      toBlock
    )
    expect(originEvents.length).to.be.greaterThanOrEqual(1)
    const specificEvent = originEvents.find(
      (event) => event.transactionHash === hashUnderTest
    )
    expect(specificEvent.args.token).to.eq(L2BOBA_BNB.address)
    expect(specificEvent.args.sourceChainId).to.eq(chainIdBnb)
    expect(specificEvent.args.toChainId).to.eq(chainId)
    expect(specificEvent.args.amount).to.eq('12000000000000000000')

    const destinationEvents = await LightBridge.queryFilter(
      'DisbursementSuccess',
      0,
      toBlock
    )
    expect(destinationEvents.length).to.be.greaterThanOrEqual(1)
    const specificDestinationEvent = destinationEvents.find(
      (event) => event.args.amount.toString() === '12000000000000000000'
    )
    expect(specificDestinationEvent.args.token).to.eq(L2BOBA_BNB.address)
    expect(specificDestinationEvent.args.sourceChainId).to.eq(chainIdBnb)
  }).timeout(600_000)

  it('should fail if deposit amount too big', async () => {
    let error
    try {
      await LightBridgeBNB.connect(signerBnb).teleportAsset(
        L2BOBA_BNB.address,
        utils.parseEther('101'), // max at 100
        chainId
      )
    } catch (e) {
      error = e
    }

    expect(error.toString()).to.contain('Deposit amount too big')
  }).timeout(280_000)
})
