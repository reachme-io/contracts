require("@nomicfoundation/hardhat-toolbox");
require('dotenv').config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.27",
  networks: {
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
  },
  defaultNetwork: 'hardhat'
};