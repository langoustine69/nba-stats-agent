/**
 * Register nba-stats-agent on Ethereum mainnet ERC-8004
 */
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';

const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const AGENT_URL = 'https://nba-stats-agent-production.up.railway.app';

// Register function ABI
const abi = [
  {
    name: 'register',
    type: 'function',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
] as const;

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('PRIVATE_KEY required');
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  console.log(`Wallet: ${account.address}`);
  
  const publicClient = createPublicClient({
    chain: mainnet,
    transport: http('https://eth.drpc.org'),
  });

  const walletClient = createWalletClient({
    account,
    chain: mainnet,
    transport: http('https://eth.drpc.org'),
  });

  const agentURI = `${AGENT_URL}/.well-known/agent.json`;
  console.log(`Registering: ${agentURI}`);

  try {
    const hash = await walletClient.writeContract({
      address: IDENTITY_REGISTRY,
      abi,
      functionName: 'register',
      args: [agentURI],
    });

    console.log(`TX submitted: ${hash}`);
    console.log(`Etherscan: https://etherscan.io/tx/${hash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`Confirmed in block: ${receipt.blockNumber}`);
    console.log('✅ nba-stats-agent registered on Ethereum mainnet!');
  } catch (error: any) {
    console.error('Error:', error.message);
  }
}

main();
