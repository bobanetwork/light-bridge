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
      url: 'https://eth.llamarpc.com',
      accounts: [process.env.DEPLOYER_PK ?? LOCAL_PK],
    },
    bsc: {
      url: 'https://binance.llamarpc.com',
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
      url: 'https://mainnet.boba.network',
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
      optimizer: { enabled: true, runs: 10_000 },
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
      arbitrumOne: "",
      bsc: "",
      mainnet: process.env.ETHERSCAN_API_KEY,
      optimisticEthereum: "",
    },
    customChains: [
      {
        network: "boba_eth_mainnet",
        chainId: 288,
        urls: {
          apiURL: "",
          browserURL: "",
        },
      },
      {
        network: "boba_bnb_mainnet",
        chainId: 56288,
        urls: {
          apiURL: "",
          browserURL: "",
        },
      }
    ],
  }
}

export default config
