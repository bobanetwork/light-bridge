import { HardhatUserConfig } from 'hardhat/types'
import '@nomiclabs/hardhat-ethers'
import '@nomiclabs/hardhat-waffle'
import "@nomiclabs/hardhat-etherscan";

require('dotenv').config()

const LOCAL_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

const config: HardhatUserConfig & {etherscan: {apiKey: any, customChains: any}} = {
  mocha: {
    timeout: 200000,
  },
  networks: {
    mainnet: {
      url: process.env.LIGHTBRIDGE_RPC_ETHMAINNET ?? 'https://eth.llamarpc.com',
      accounts: [process.env.DEPLOYER_PK ?? LOCAL_PK],
    },
    bsc: {
      url: 'https://bsc-pokt.nodies.app',
      accounts: [process.env.DEPLOYER_PK ?? LOCAL_PK],
    },
    arbitrumOne: {
      url: 'https://1rpc.io/arb',
      accounts: [process.env.DEPLOYER_PK ?? LOCAL_PK],
    },
    optimisticEthereum: {
      url: 'https://rpc.optimism.gateway.fm',
      accounts: [process.env.DEPLOYER_PK ?? LOCAL_PK],
    },
    boba_eth_mainnet: {
      url: process.env.LIGHTBRIDGE_RPC_BOBAETHMAINNET ?? 'https://mainnet.boba.network',
      accounts: [process.env.DEPLOYER_PK ?? LOCAL_PK],
    },
    boba_bnb_mainnet: {
      url: 'https://gateway.tenderly.co/public/boba-bnb',
      accounts: [process.env.DEPLOYER_PK ?? LOCAL_PK],
    },
    boba_sepolia: {
      url: 'https://sepolia.boba.network',
      accounts: [process.env.DEPLOYER_PK ?? LOCAL_PK],
    },
    sepolia: {
      url: 'https://ethereum-sepolia.publicnode.com',
      accounts: [process.env.DEPLOYER_PK ?? LOCAL_PK],
    },
    boba_goerli: {
      url: 'https://goerli.boba.network',
      accounts: [process.env.DEPLOYER_PK ?? LOCAL_PK],
    },
    localhost: {
      url: 'http://localhost:9545',
      allowUnlimitedContractSize: true,
      timeout: 1800000,
      accounts: [
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      ],
    },
  },
  solidity: {
    version: '0.8.9',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY,
      arbitrumOne: process.env.ARBISCAN_API_KEY,
      bsc: process.env.BSCSCAN_API_KEY,
      mainnet: process.env.ETHERSCAN_API_KEY,
      optimisticEthereum: process.env.OPTIMISMSCAN_API_KEY,
      boba_eth_mainnet: "boba", // not required, set placeholder
      boba_bnb_mainnet: "boba", // not required, set placeholder
    },
    customChains: [
      {
        network: "boba_eth_mainnet",
        chainId: 288,
        urls: {
          apiURL: "https://api.routescan.io/v2/network/mainnet/evm/288/etherscan",
          browserURL: "https://bobascan.com"
        },
      },
      {
        network: "boba_bnb_mainnet",
        chainId: 56288,
        urls: {
          apiURL: "https://api.routescan.io/v2/network/mainnet/evm/56288/etherscan",
          browserURL: "https://bobascan.com"
        },
      }
    ],
  }
}

export default config
