import { expect } from './setup'

/* External Imports */
import { ethers, network } from 'hardhat'
import {
  Contract,
  ContractFactory,
  providers,
  Signer,
  utils,
  Wallet,
} from 'ethers'

/* Imports: Artifacts */
import LightBridgeJson from '../artifacts/contracts/LightBridge.sol/LightBridge.json'
import L1ERC20Json from '../artifacts/contracts/test-helpers/L1ERC20.sol/L1ERC20.json'

/* Imports: Interface */
import { Asset, ChainInfo, ELayer } from '../src'

/* Imports: Core */
import { AppDataSource } from '../src/data-source'
import dotenv from 'dotenv'
import main from '../src/exec/run'

dotenv.config()

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
    await network.provider.request({
      method: 'hardhat_reset',
      params: [],
    })
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

    chainId = (await provider.getNetwork()).chainId
    chainIdBnb = (await providerBnb.getNetwork()).chainId

    signer = new Wallet(
      process.env.PRIVATE_KEY_1 ??
        '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
      provider
    )
    signerAddr = await signer.getAddress()
    wallet1 = new Wallet(
      process.env.PRIVATE_KEY_2 ??
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
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
        layer: ELayer.Layer2,
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
        layer: ELayer.Layer2,
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
      LIGHTBRIDGE_AWS_KMS_KEY_ID: 'lb_disburser_pk',
      LIGHTBRIDGE_AWS_KMS_ENDPOINT: 'http://kms:8888',
      LIGHTBRIDGE_AWS_KMS_REGION: 'us-east-1',
      __LOCAL_NETWORKS: JSON.stringify(__LOCAL_NETWORKS),
    }

    main().then((res) => console.log('--- main() DONE!')) // do not await as it would block tests
    await delay(8000)
  }

  const delay = (ms: number) => {
    return new Promise((resolve) => setTimeout(resolve, ms))
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

    const originEvents = await LightBridgeBNB.queryFilter(
      'AssetReceived',
      0,
      100
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
      100
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
