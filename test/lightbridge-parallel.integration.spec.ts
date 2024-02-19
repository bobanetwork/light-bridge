import { expect } from './setup'

/* External Imports */
import { ethers } from 'hardhat'
import {
  BigNumber,
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
import { ChainInfo, IBobaChain, LightBridgeService } from '../src'

/* Imports: Core */
import { AppDataSource } from '../src/data-source'
import { Asset } from '../src'
import dotenv from 'dotenv'
import main from '../src/exec/run'

dotenv.config()

describe.only('lightbridge parallel', () => {
  let providerUrl: string
  let provider: providers.JsonRpcProvider
  let signer: Signer
  let signerAddr: string

  let wallet1: Wallet
  let address1: string

  let selectedBobaChains: ChainInfo[]

  const defaultMinDepositAmount = utils.parseEther('1')
  const defaultMaxDepositAmount = utils.parseEther('100')
  const defaultMaxTransferPerDay = utils.parseEther('100000')

  before(async () => {
    await AppDataSource.initialize()
    await AppDataSource.synchronize(true) // drops database and recreates

    providerUrl = process.env.RPC_URL ?? 'http://anvil:8545'
    provider = new providers.JsonRpcProvider(providerUrl)
    console.warn('Using provider: ', providerUrl)
    // must be the same as for AWS KMS (see kms-seed.yml)
    signer = new Wallet(
      process.env.PRIVATE_KEY_1 ??
        '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
      provider
    ) // PK used by anvil (public anyway)
    signerAddr = await signer.getAddress()
    wallet1 = new Wallet(
      process.env.PRIVATE_KEY_2 ??
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      provider
    ) // PK used by anvil (public anyway)
    address1 = wallet1.address

    console.warn('Using wallet: ', address1)

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
  let __LOCAL_NETWORKS: ChainInfo[]
  let lightBridgeServices: LightBridgeService[]

  // Here to have an easy way to modify globally
  const airdropConfig = {
    airdropAmountWei: ethers.utils.parseEther('1'),
    airdropCooldownSeconds: 1000,
  }

  before(async () => {
    chainId = (await provider.getNetwork()).chainId
    chainIdBobaBnb = chainId // needs to be the same since service reads it from provider

    Factory__Teleportation = new ethers.ContractFactory(
      LightBridgeJson.abi,
      LightBridgeJson.bytecode,
      wallet1
    )

    LightBridge = await Factory__Teleportation.deploy()
    await LightBridge.deployTransaction.wait()

    LightBridgeBNB = await Factory__Teleportation.deploy()
    await LightBridgeBNB.deployTransaction.wait()

    // intialize the teleportation contract
    await LightBridge.initialize()
    await LightBridgeBNB.initialize()

    console.warn(
      'Owner/Disburser for light bridge: ',
      await LightBridge.disburser(),
      await LightBridgeBNB.disburser()
    )

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

    // add the supported chain & token
    await LightBridge.addSupportedToken(
      L2BOBA.address,
      chainIdBobaBnb,
      defaultMinDepositAmount,
      defaultMaxDepositAmount,
      defaultMaxTransferPerDay
    )
    await LightBridge.addSupportedToken(
      ethers.constants.AddressZero,
      chainIdBobaBnb,
      defaultMinDepositAmount,
      defaultMaxDepositAmount,
      defaultMaxTransferPerDay
    )
    await LightBridgeBNB.addSupportedToken(
      L2BOBA.address,
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
      },
      {
        chainId: chainIdBobaBnb,
        url: providerUrl,
        provider: provider,
        testnet: true,
        name: 'localhost:bnb',
        teleportationAddress: LightBridgeBNB.address,
        height: 0,
        supportedAssets: {
          [L2BOBA.address?.toLowerCase()]: Asset.BOBA,
          [ethers.constants.AddressZero?.toLowerCase()]: Asset.ETH,
        },
      },
      // bnb will be added in routing tests to have cleaner before hooks
    ]

    __LOCAL_NETWORKS = selectedBobaChains

    console.log('STARTING NOW')
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

    main() // do not await as it would block tests
    await delay(8000)
  }

  const delay = (ms: number) => {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  it('should watch LightBridge contract', async () => {
    console.log('Waiting a few seconds to let parallel services to start up. ')
    await delay(15)

    // deposit token
    const amount = utils.parseEther('5')
    const preBalanceBobaSigner = await L2BOBA.balanceOf(signerAddr)
    const preBalanceBobaDisburser = await L2BOBA.balanceOf(wallet1.address)

    await L2BOBA.approve(LightBridge.address, amount)
    const bridgeTx = await LightBridge.connect(signer).teleportAsset(
      L2BOBA.address,
      amount,
      chainIdBobaBnb
    )
    console.warn('Bridged tx........')
    //await bridgeTx.wait(2)
    await delay(2000)
    console.warn('confirmed tx......')

    const postBalanceBobaSigner = await L2BOBA.balanceOf(signerAddr)
    const postBalanceBobaDisburser = await L2BOBA.balanceOf(wallet1.address)
    expect(preBalanceBobaSigner).to.be.gt(postBalanceBobaSigner)
    expect(preBalanceBobaDisburser).to.be.lt(postBalanceBobaDisburser)

    /*expect(events.length).to.be.eq(2)
    expect(events[1].args.token).to.be.eq(L2BOBA.address)
    expect(events[1].args.sourceChainId).to.be.eq(chainId)
    expect(events[1].args.toChainId).to.be.eq(chainId)
    expect(events[1].args.depositId).to.be.eq(16)
    expect(events[1].args.emitter).to.be.eq(signerAddr)
    expect(events[1].args.amount).to.be.eq(utils.parseEther('11'))*/
  })
})
