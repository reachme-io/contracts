# ReachMe Contracts

## Table of Contents
- [Contracts](#contracts)
- [Getting Started](#getting-started)

## Contracts

#### BNB Mainnet
 
|       Contract    | Address |
|     ------------- | ------------- |
| Authority.sol  | [TBA](https://bscscan.com/address/0x0000000000000000000000000000000000000000) |
| Reach.sol  | [TBA](https://bscscan.com/address/0x0000000000000000000000000000000000000000) |

#### BNB Testnet

|       Contract    | Address |
|     ------------- | ------------- |
| Authority.sol  | [0x09E8Fd5E3A9fF938d41A91da8d984BA5c10c3527](https://testnet.bscscan.com/address/0x09E8Fd5E3A9fF938d41A91da8d984BA5c10c3527) |
| Reach.sol  | [0x7739f1c1056633A5F5FD9792d47C92eb53e123bB](https://testnet.bscscan.com/address/0x7739f1c1056633A5F5FD9792d47C92eb53e123bB) |


## Getting Started

#### Setup
```shell
git clone git@github.com:reachme-io/contracts.git
```

```shell
cd contracts
```

```shell
npm i
```

#### Compile Contracts

```shell
npx hardhat compile
```


#### Test contracts
```shell
npx hardhat test
```

#### Set ENV Variables

```shell
cp .env.example .env
```

```shell
nano .env
```

Edit .env file with live variables

#### Deploy

```shell
npx hardhat run scripts/deploy.js --network bnb-testnet
```

#### Verify on BSCScan

```shell
npx hardhat verify --network bnb-testnet [contract_address] [constructor_arguments]
```

### Deploy AND Verify on BSCScan

```shell
npx hardhat run scripts/deploy.js --network bnb-testnet --verify
```

### Flatten Contracts 
```shell
npx hardhat flatten contracts/Reach.sol > Reach_Flattened.sol && \
npx hardhat flatten contracts/Authority.sol > Authority_Flattened.sol
```

