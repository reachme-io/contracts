# Reach Contracts

## Table of Contents
- [Getting Started](#getting-started)
- [Contracts](#contracts)

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

### Deploy AND Verify on Etherscan

```shell
npx hardhat run scripts/deploy.js --network bnb-testnet --verify
```

### Flatten Contracts
```shell
npx hardhat flatten contracts/Reach.sol > Reach_Flattened.sol
```


## Contracts

#### BSC Testnet

|       Contract    | Address |
|     ------------- | ------------- |
| Reach.sol  | [0x14c0B26753d310ECf244cb2eDa84bCFdb8C4Eb9b](https://testnet.bscscan.com/address/0x14c0B26753d310ECf244cb2eDa84bCFdb8C4Eb9b) |


#### BSC Mainnet
 
|       Contract    | Address |
|     ------------- | ------------- |
| Reach.sol  | [TBA](https://bscscan.com/address/0x0000000000000000000000000000000000000000) |
