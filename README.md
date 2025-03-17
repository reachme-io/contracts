# ReachMe Contracts

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

### Deploy AND Verify on BSCScan

```shell
npx hardhat run scripts/deploy.js --network bnb-testnet --verify
```

### Flatten Contracts 
```shell
npx hardhat flatten contracts/Reach.sol > Reach_Flattened.sol && \
npx hardhat flatten contracts/Authority.sol > Authority_Flattened.sol
```

## Contracts

#### BSC Testnet

|       Contract    | Address |
|     ------------- | ------------- |
| Authority.sol  | [0x09E8Fd5E3A9fF938d41A91da8d984BA5c10c3527](https://testnet.bscscan.com/address/0x09E8Fd5E3A9fF938d41A91da8d984BA5c10c3527) |
| Reach.sol  | [0xf6C8E7017E3dC8fddB1503bBA5B1D476E66525fd](https://testnet.bscscan.com/address/0xf6C8E7017E3dC8fddB1503bBA5B1D476E66525fd) |


#### BSC Mainnet
 
|       Contract    | Address |
|     ------------- | ------------- |
| Authority.sol  | [TBA](https://bscscan.com/address/0x0000000000000000000000000000000000000000) |
| Reach.sol  | [TBA](https://bscscan.com/address/0x0000000000000000000000000000000000000000) |
