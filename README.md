# Light Bridge

This service monitors the on-chain events and release funds when a new deposit is found.

## Run hardhat scripts
Example: `npx hardhat run ./deploy/transfer-ownership.ts --network boba_sepolia`

## Configuration

All configuration is done via environment variables. See all variables at [.env.example](.env.example); copy into a `.env` file before running.

|                                         | Description                                              | Default             |
|-----------------------------------------|----------------------------------------------------------|---------------------|
| LIGHTBRIDGE_REJECT_UNAUTHORIZED         | Allows self-signed certificates if false (TypeORM)       | true                |
| LIGHTBRIDGE_DISBURSER_KEY               | The pk of disburser                                      |                     |
| LIGHTBRIDGE_POLLING_INTERVAL            | The polling interval of fetching events                  | 60s                 |
| LIGHTBRIDGE_BLOCK_RANGE_PER_POLLING     | The block range of each polling                          | 1000                |
| LIGHTBRIDGE_POSTGRES_CONNECT_TIMEOUT_MS | DB connect timeout in ms                                 | Typeorm default     |
| LIGHTBRIDGE_RETRY_INTERVAL_MS           | Lightbridge retry interval ms in error cases per service | 30_000 milliseconds |
| LIGHTBRIDGE_POSTGRES_PASSWORD           | The database password                                    | abcdef              |
| LIGHTBRIDGE_POSTGRES_DB_HOST            | The database host                                        | LIGHTBRIDGE_db      |
| LIGHTBRIDGE_POSTGRES_DB                 | The database name                                        | postgres            |
| LIGHTBRIDGE_POSTGRES_PORT               | The database port                                        | 5432                |
| LIGHTBRIDGE_POSTGRES_USER               | The database user                                        | postgres            |
| LIGHTBRIDGE_MODE                        | Which rpcUrls to use? testnets or mainnets               | testnets            |
| LIGHTBRIDGE_ENV                         | The environment mode (dev or prod)                       | dev                 |
| LIGHTBRIDGE_ENABLE_EXIT_FEE             | Enable exit fee (1%, statically set on Gateway too)      | true                |

## Building & Running

1. Make sure dependencies are installed - run `yarn` in the base directory
2. Build `yarn build`
3. Run `yarn start`

## Postgresql

Connect to Postgres on CLI:
`psql --username postgres -d postgres --password`

## Deployments

Contract audited [here](https://github.com/bobanetwork/boba/blob/develop/boba_audits/Boba%20Network%202%20%26%203%20-%20Quantstamp%20Final%20Report.pdf).

## Wallets
Make sure disbursers have enough liquidity in form of the native asset (such as ETH) and in form of supported tokens (such as BOBA).

---

## Mainnet deployments

### Ethereum Mainnet (L1)
- LightBridge deployed to: `0x3f7Da9C51138E0475aA26E80677d27A568cFD6b9`
- Proxy__LightBridge deployed to: `0x2dE73Bd1660Fbf4D521a52Ec2a91CCc106113801`
- Disburser transferred by Multisig to AWS KMS managed key: `0x2d02ce7ef2f359bdcf86e44f66345660725e5cce`
- Owner transferred to multisig `0x56121a8612474C3eB65D69a3b871f284705b9bC4` [Tx](https://bobascan.com/tx/0xc42037c770cd88d73ee49c8daffc9c27da5f79d7d2fb0c6f307cc37a9bc850c1)

### Optimism Mainnet
- LightBridge deployed to: `0x3f7Da9C51138E0475aA26E80677d27A568cFD6b9`
- Proxy__LightBridge deployed to: `0x2dE73Bd1660Fbf4D521a52Ec2a91CCc106113801`
- Disburser transferred to AWS KMS managed key on 12 March 2024: `0x2d02ce7ef2f359bdcf86e44f66345660725e5cce`
- Owner transferred to multisig on 12 March 2024: `0x8d89a7570bE8F43c7f4124F044bCAd98f72e7057`

### Arbitrum Mainnet
- LightBridge deployed to: `0x3f7Da9C51138E0475aA26E80677d27A568cFD6b9`
- Proxy__LightBridge deployed to: `0x2dE73Bd1660Fbf4D521a52Ec2a91CCc106113801`
- Disburser transferred to AWS KMS managed key on 12 March 2024: `0x2d02ce7ef2f359bdcf86e44f66345660725e5cce`
- Owner transferred to multisig on 12 March 2024: `0x30687BDFA9CbEE46EBc7D0acA148971203C17ef8`

### Boba ETH Mainnet
- LightBridge deployed to: `0x670b130112C6f03E17192e63c67866e67D77c3ee`
- Proxy__LightBridge deployed to: `0x0dfFd3Efe9c3237Ad7bf94252296272c96237FF5`
- Disburser transferred by Multisig to AWS KMS managed key: `0x2d02ce7ef2f359bdcf86e44f66345660725e5cce`
- Owner transferred to multisig `0x1C03e7e6db3174f0C68b245FF8c81e9Cfa1EE2e0` [Tx](https://bobascan.com/tx/0x5003543d7cd1ce7748883343dba5f3db55ec2e8493d1f88acd5f17ebd0ad9775)

### BSC Mainnet
- LightBridge deployed to: `0x670b130112C6f03E17192e63c67866e67D77c3ee`
- Proxy__LightBridge deployed to: `0x0dfFd3Efe9c3237Ad7bf94252296272c96237FF5`
- Disburser transferred by Multisig to AWS KMS managed key on 12 March 2024: `0x2d02ce7ef2f359bdcf86e44f66345660725e5cce`
- Onwer transferred to multisig on 12 March 2024: `0x30687BDFA9CbEE46EBc7D0acA148971203C17ef8`

### BSC Boba Mainnet
- LightBridge deployed to: `0x45B9877497d73C683D38e0C7FfCf089D5D9FDCDf`
- Proxy__LightBridge deployed to: `0x670b130112C6f03E17192e63c67866e67D77c3ee`
- Disburser transferred on 06 March 2024 to AWS KMS managed key: `0x2d02ce7ef2f359bdcf86e44f66345660725e5cce`
- Owner transferred on 08 March 2024 to Multisig: `0x8d89a7570bE8F43c7f4124F044bCAd98f72e7057`

## Testnet deployments

### Sepolia (L1)
- LightBridge deployed to: `0x6550b0B7e3D2dD0E0382E0638B0f56F614921CA5`
- Proxy__LightBridge deployed to: `0xaeE12b8D99BBff7ED47866DF868CF5b4b3F73ffF`
- Disburser transferred to AWS KMS managed wallet on 22 May 2024: `0x9c863e4ec4bf665a93e631d43442970187975baf`
- Owner managed by EOA: `0x48baCac867ef377fac62186A79e8381665cfae6B`

### BNB Testnet (L1)
- LightBridge deployed to: `0xD151c8F0dc69618e6180a2dC74B05cCE3E08e0aC`
- Proxy__LightBridge deployed to: `0x7f6a32bCaA70c65E08F2f221737612F6fC18347A`
- Disburser transferred to AWS KMS managed wallet on 22 May 2024: `0x9c863e4ec4bf665a93e631d43442970187975baf`
- Owner managed by EOA: `0x48baCac867ef377fac62186A79e8381665cfae6B`

### Boba Sepolia
- LightBridge deployed to: `0x3f7Da9C51138E0475aA26E80677d27A568cFD6b9`
- Proxy__LightBridge deployed to: `0x2dE73Bd1660Fbf4D521a52Ec2a91CCc106113801`
- Disburser transferred to AWS KMS managed wallet on 22 May 2024: `0x9c863e4ec4bf665a93e631d43442970187975baf`
- Owner managed by EOA: `0x48baCac867ef377fac62186A79e8381665cfae6B`

### Boba BNB Testnet
- LightBridge deployed to: `0x46FA6144C61d2bb9aCDc3Ca90C8673dd9B6caEB2`
- Proxy__LightBridge deployed to: `0xf4d179d3a083Fa3Eede935FaF4C679D32d514186`
- Disburser transferred to AWS KMS managed wallet on 22 May 2024: `0x9c863e4ec4bf665a93e631d43442970187975baf`
- Owner managed by EOA: `0x48baCac867ef377fac62186A79e8381665cfae6B`

### Arbitrum Sepolia
- LightBridge deployed to: `0x4f7E3fF7B52e9843097A8CB3F1b083a8fF6f8c9b`
- Proxy__LightBridge deployed to: `0x3fc06c53aa3Ef19ad7830f5F18C9186C676EdE29`
- Disburser transferred to AWS KMS managed wallet on 22 May 2024: `0x9c863e4ec4bf665a93e631d43442970187975baf`
- Owner: `0x48baCac867ef377fac62186A79e8381665cfae6B`

### Optimism Sepolia
- LightBridge deployed to: `0x4f7E3fF7B52e9843097A8CB3F1b083a8fF6f8c9b`
- Proxy__LightBridge deployed to: `0x3fc06c53aa3Ef19ad7830f5F18C9186C676EdE29`
- Disburser transferred to AWS KMS managed wallet on 22 May 2024: `0x9c863e4ec4bf665a93e631d43442970187975baf`
- Owner: `0x48baCac867ef377fac62186A79e8381665cfae6B`

---

## Supported routes

### BOBA
- `BOBA BNB Mainnet` <-> `BNB Mainnet`
- `BOBA BNB Mainnet` <-> `BOBA ETH Mainnet`
- `ETH Mainnet` <-> `BOBA ETH Mainnet`
- `BOBA ETH Mainnet` <-> `BNB Mainnet`

### BNB
- `BOBA BNB Mainnet` <-> `BNB Mainnet`

### ETH
- `Arbitrum Mainnet` -> `BOBA ETH Mainnet`
- `Optimism Mainnet` -> `BOBA ETH Mainnet`
- `ETH Mainnet` <-> `BOBA ETH Mainnet`



---

## User flow / Dev flow:
![TeleportationFlow](https://github.com/bobanetwork/boba/assets/28724551/1c5fceb8-126d-42d1-92b4-59ec5ed9ad71)

### Wallet based overview
![WalletLiquidity](https://github.com/bobanetwork/light-bridge/assets/28724551/5a6f28e0-80e1-4e73-8125-b2a4301dd00d)


---

## Contract params
This section describes how whitelisted routes between networks can be configured. By default no asset can be bridged, not even the native asset - all need to be explicitly whitelisted.

Asset support is configured on-chain on the LightBridge contract via
`function addSupportedToken(address _token, uint32 _toChainId, uint256 _minDepositAmount, uint256 _maxDepositAmount, uint256 _maxTransferAmountPerDay)`.

### Indicate support
Support for an asset can be shut down and re-activated at any time (yes|no value).

### Minimum Deposit Amount
The minimum amount that needs to be deposited in order to be bridged. The value refers to the asset to be bridged (e.g. ETH or BOBA tokens) and will revert for transactions that do not exceed this threshold (>=).

### Maximum Deposit Amount
The maximum amount that can be deposited within one single bridge operation. The value refers to the asset that is being bridged and will revert for transactions that exceed this value.

### Maximum Amount Per Day
The maximum amount per day limits how many units of the asset to be bridged can be moved to the corresponding network per day.

---

## AWS KMS
You will need a disburser key managed through KMS with the following configuration: 

- Key type: `asymmetric`
- Usage: `Signing/verifying`
- Specification: `ECC_SECG_P256K1`

Advanced Options:
- Origin: `KMS`
- Regionality: `Multi Region Key`

---

## Storage slot
Storage slot for the proxyTarget: `0x77c70ab2411972e3fdfbab35b6ae1519d867baa21725dd08c381964443dcc9aa`

```shell

curl https://api.tenderly.co/api/v1/account/$ACCOUNT_SLUG/project/$PROJECT_SLUG/contracts/encode-states -H "X-Access-Key: $API_KEY" \
-d '{
  "networkID":"1",
  "stateOverrides": {
    "0x2de73bd1660fbf4d521a52ec2a91ccc106113801": {
      "value": {
        "addressManager[\"proxyTarget\"]": "0x0000000000000000000000000000000000000000"
      }
    }
  }
}' | jq
```

Result: 
```json 

{
  "stateOverrides": {
    "0x2de73bd1660fbf4d521a52ec2a91ccc106113801": {
      "value": {
        "0x77c70ab2411972e3fdfbab35b6ae1519d867baa21725dd08c381964443dcc9aa": "0x0000000000000000000000000000000000000000000000000000000000000000"
      }
    }
  }
}

```
