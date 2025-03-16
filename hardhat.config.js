require("@nomicfoundation/hardhat-toolbox");
require('dotenv').config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.27",
  networks: {
    hardhat: {
      forking: {
        url: process.env.FORKING_URL || 'https://mainnet.base.org',
        chainId: 84531111,
      },
    },
    localhost: {
      url: 'http://localhost:8545',
      accounts: [process.env.ETHEREUM_PRIVATE_KEY],
      gasPrice: 1000000000,
    },
    'bnb-testnet': {
      url: 'https://bnb-testnet.g.alchemy.com/v2/913GnXmXsjrTQ17ObaU6yrcmeIEVeA3z',
      accounts: [process.env.ETHEREUM_PRIVATE_KEY],
      gasPrice: 2000000000,
    },
    'base-mainnet': {
      url: 'https://mainnet.base.org',
      accounts: [process.env.ETHEREUM_PRIVATE_KEY],
      gasPrice: 1000000000,
    },
    'base-sepolia': {
      url: 'https://sepolia.base.org',
      accounts: [process.env.ETHEREUM_PRIVATE_KEY],
      gasPrice: 2000000000, // this is 2 Gwei
    }
  },
  defaultNetwork: 'hardhat',
  etherscan: {
    apiKey: {
      "base-sepolia": process.env.BASESCAN_API_KEY,
      'base-mainnet': process.env.BASESCAN_API_KEY
    },
    customChains: [
      {
        network: "base-sepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org"
        }
      },
      {
        network: "base-mainnet",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org"
        }
      }
    ]
  },
};