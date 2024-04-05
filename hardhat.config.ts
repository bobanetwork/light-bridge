import { HardhatUserConfig } from 'hardhat/types'
import '@nomiclabs/hardhat-ethers'
import '@nomiclabs/hardhat-waffle'
import '@nomiclabs/hardhat-etherscan'

require('dotenv').config()

const LOCAL_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

const config: HardhatUserConfig & { etherscan: { apiKey: any, customChains: any } } = {
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
      url: 'https://boba-bnb.gateway.tenderly.co/2AxEAq0m880KJmS2KicNRf',
      accounts: [process.env.DEPLOYER_PK ?? LOCAL_PK],
    },
    boba_sepolia: {
      url: 'https://sepolia.boba.network',
      accounts: [process.env.DEPLOYER_PK ?? LOCAL_PK],
    },
    goerli: {
      url: 'https://rpc.ankr.com/eth_goerli',
      accounts: [process.env.DEPLOYER_PK ?? LOCAL_PK],
    },
    sepolia: {
      url: 'https://ethereum-sepolia.publicnode.com',
      accounts: [process.env.DEPLOYER_PK ?? LOCAL_PK],
    },
    arb_goerli: {
      url: 'https://arbitrum-goerli-rpc.publicnode.com',
      accounts: [process.env.DEPLOYER_PK ?? LOCAL_PK],
    },
    arb_sepolia: {
      url: 'https://public.stackup.sh/api/v1/node/arbitrum-sepolia',
      accounts: [process.env.DEPLOYER_PK ?? LOCAL_PK],
    },
    bsc_testnet: {
      url: 'https://bsc-testnet.blockpi.network/v1/rpc/public',
      accounts: [process.env.DEPLOYER_PK ?? LOCAL_PK],
    },
    boba_bnb_testnet: {
      url: 'https://boba-bnb-testnet.gateway.tenderly.co',
      accounts: [process.env.DEPLOYER_PK ?? LOCAL_PK],
    },
    op_goerli: {
      url: 'https://optimism-goerli-rpc.publicnode.com',
      accounts: [process.env.DEPLOYER_PK ?? LOCAL_PK],
    },
    op_sepolia: {
      url: 'https://sepolia.optimism.io',
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
    compilers: [
      {
        version: '0.8.9',
        settings: {
          // 10k too much for boba mainnets, ..
          optimizer: { enabled: true, runs: 200 },
        },
      },
      {
        version: '0.4.11',
        settings: {
          // 10k too much for boba mainnets, ..
          optimizer: { enabled: true, runs: 200 },
        },
      },
    ],
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY,
      arbitrumOne: process.env.ARBISCAN_API_KEY,
      bsc: process.env.BSCSCAN_API_KEY,
      mainnet: process.env.ETHERSCAN_API_KEY,
      optimisticEthereum: process.env.OPTIMISMSCAN_API_KEY,
      op_sepolia: process.env.OPTIMISMSCAN_API_KEY,
      arb_sepolia: process.env.ARBISCAN_API_KEY,
      boba_eth_mainnet: "boba", // not required, set placeholder
      boba_bnb_mainnet: "boba", // not required, set placeholder
      boba_goerli: "boba", // not required, set placeholder
      boba_bnb_testnet: "boba", // not required, set placeholder
      boba_sepolia: "boba", // not required, set placeholder
    },
    customChains: [
      {
        network: "op_sepolia",
        chainId: 11155420,
        urls: {
          apiURL: "https://api-sepolia-optimistic.etherscan.io/api",
          browserURL: "https://sepolia-optimism.etherscan.io"
        },
      },
      {
        network: "arb_sepolia",
        chainId: 421614,
        urls: {
          apiURL: "https://api-sepolia.arbiscan.io/api",
          browserURL: "https://sepolia.arbiscan.io"
        },
      },
      {
        network: "boba_eth_mainnet",
        chainId: 288,
        urls: {
          apiURL: 'https://api.routescan.io/v2/network/mainnet/evm/288/etherscan',
          browserURL: 'https://bobascan.com',
        },
      },
      {
        network: 'boba_bnb_mainnet',
        chainId: 56288,
        urls: {
          apiURL: 'https://api.routescan.io/v2/network/mainnet/evm/56288/etherscan',
          browserURL: 'https://bobascan.com',
        },
      },
      {
        network: 'boba_goerli',
        chainId: 2888,
        urls: {
          apiURL: 'https://api.routescan.io/v2/network/testnet/evm/2888/etherscan',
          browserURL: 'https://testnet.bobascan.com',
        },
      },
      {
        network: 'boba_sepolia',
        chainId: 28882,
        urls: {
          apiURL: 'https://api.routescan.io/v2/network/testnet/evm/28882/etherscan',
          browserURL: 'https://testnet.bobascan.com',
        },
      },
      {
        network: 'boba_bnb_testnet',
        chainId: 9728,
        urls: {
          apiURL: 'https://api.routescan.io/v2/network/testnet/evm/9728/etherscan',
          browserURL: 'https://testnet.bobascan.com',
        },
      },
    ],
  },
}

export default config
