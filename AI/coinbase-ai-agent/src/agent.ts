import { CdpAgentkit } from "@coinbase/cdp-agentkit-core";
import { CdpToolkit } from "@coinbase/cdp-langchain";
import { HumanMessage } from "@langchain/core/messages";
// import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { DynamicTool } from "@langchain/core/tools";
import { MemorySaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { TwitterApi } from "twitter-api-v2";
import * as dotenv from "dotenv";
import * as fs from "fs";

dotenv.config();

// Configure a file to persist the agent's CDP MPC Wallet Data
const WALLET_DATA_FILE = "wallet_data.txt";

export class BaseAIAgent {
  private agentkit: CdpAgentkit | undefined;
  private agent: any; // ReAct agent
  private twitterClient: TwitterApi;
  private agentConfig: any;
  private processedTweets: Set<string> = new Set();
  private lastProcessedMentionId: string | null = null;

  constructor() {
    // Initialize Twitter client for OAuth 2.0.
    // The user-level tokens will be applied in the async initialize method.
    this.twitterClient = new TwitterApi({
      clientId: process.env.TWITTER_CLIENT_ID!,
      clientSecret: process.env.TWITTER_CLIENT_SECRET!,
    });
  }

  async initialize() {
    // Authenticate with Twitter using the OAuth 2.0 refresh token
    try {
      console.log("Authenticating with Twitter...");
      const { client: refreshedClient, accessToken, refreshToken: newRefreshToken } = await this.twitterClient.refreshOAuth2Token(process.env.TWITTER_REFRESH_TOKEN!);
      this.twitterClient = refreshedClient;
      console.log("Twitter authentication successful.");

      // If a new refresh token is issued, save it for future use.
      if (newRefreshToken) {
        console.log("A new Refresh Token was issued. Updating .env file...");
        try {
          const envPath = '.env';
          let envFileContent = fs.readFileSync(envPath, 'utf8');
          // Use a regular expression to safely replace the token, or add it if it doesn't exist
          if (envFileContent.includes('TWITTER_REFRESH_TOKEN')) {
            envFileContent = envFileContent.replace(
              /^TWITTER_REFRESH_TOKEN=.*$/m,
              `TWITTER_REFRESH_TOKEN=${newRefreshToken}`
            );
          } else {
            envFileContent += `\nTWITTER_REFRESH_TOKEN=${newRefreshToken}`;
          }
          fs.writeFileSync(envPath, envFileContent);
          console.log(".env file updated successfully with new refresh token.");
        } catch (error) {
          console.error("Error updating .env file:", error);
          console.log("Please update the TWITTER_REFRESH_TOKEN in your .env file manually with:", newRefreshToken);
        }
      }
    } catch (error) {
      console.error("Failed to refresh Twitter token:", error);
      console.log("Please run 'npm run auth' to get a new refresh token and update your .env file.");
      throw new Error("Twitter authentication failed.");
    }

    let walletDataStr: string | null = null;

    // Read existing wallet data if available
    if (fs.existsSync(WALLET_DATA_FILE)) {
      try {
        walletDataStr = fs.readFileSync(WALLET_DATA_FILE, "utf8");
      } catch (error) {
        console.error("Error reading wallet data:", error);
        // Continue without wallet data
      }
    }

    // Configure CDP Agentkit with Base Sepolia
    const config = {
      networkId: "base-sepolia",
      cdpWalletData: walletDataStr || undefined,
    };

    this.agentkit = await CdpAgentkit.configureWithWallet(config);

    // Initialize LLM
    const llm = new ChatOpenAI({
      openAIApiKey: process.env.OPENAI_API_KEY!,
      modelName: "gpt-4o-mini",
    });

    // Initialize CDP tools
    const cdpToolkit = new CdpToolkit(this.agentkit);
    const tools = cdpToolkit.getTools();

    // Add custom Twitter tool that handles both replies and new tweets
    const twitterTool = new DynamicTool({
      name: "send_tweet",
      description:
        "Send a tweet. Input format: for new tweet just send the text, for replies use format 'REPLY:tweetId:text'",
      func: async (input: string) => {
        try {
          if (input.startsWith("REPLY:")) {
            const [_, replyToId, text] = input.split(":", 3);
            const result = await this.twitterClient.v2.reply(text, replyToId);
            return `Tweet sent as reply: ${result.data.id}`;
          } else {
            const result = await this.twitterClient.v2.tweet(input);
            return `Tweet sent: ${result.data.id}`;
          }
        } catch (error) {
          console.error("Error sending tweet:", error);
          throw new Error("Failed to send tweet");
        }
      },
    });

    tools.push(twitterTool);

    // Store conversation history
    const memory = new MemorySaver();
    this.agentConfig = { configurable: { thread_id: "Base AI Agent" } };

    // Create ReAct Agent
    this.agent = createReactAgent({
      llm,
      tools,
      checkpointSaver: memory,
      messageModifier:
        "You are a fun and engaging AI agent on Base blockchain. You can perform various onchain actions and interact with users via Twitter. " +
        "You have access to Base Sepolia testnet. If you need funds, use the faucet. " +
        "Your personality is creative, helpful, and enthusiastic about crypto and web3. " +
        "You can deploy tokens, mint NFTs, and perform other blockchain operations. " +
        "Don't use markdown or HTML in your responses. " +
        "When users ask for something you can't do, suggest alternatives or guide them to Coinbase Developer Platform or QuickNode Marketplace Team. " +
        "Keep responses short, concise, and engaging, using emojis where appropriate. " +
        "When replying to a tweet, formulate your response and then use the send_tweet tool with format 'REPLY:tweetId:yourResponse'.",
    });

    // Save wallet data
    const exportedWallet = await this.agentkit.exportWallet();
    fs.writeFileSync(WALLET_DATA_FILE, exportedWallet);

    console.log("Agent initialized on Base Sepolia");
  }

  async handleTweet(
    tweetText: string,
    authorUsername: string,
    tweetId: string
  ) {
    if (this.processedTweets.has(tweetId)) {
      console.log(`Tweet ${tweetId} already processed, skipping...`);
      return;
    }

    try {
      console.log(
        `Processing tweet ${tweetId} from @${authorUsername}: ${tweetText}`
      );
      this.processedTweets.add(tweetId);

      const stream = await this.agent.stream(
        {
          messages: [
            new HumanMessage(
              `User @${authorUsername} tweeted: ${tweetText}\n` +
                `Process their request and respond appropriately. ` +
                `When you have your response ready, use the send_tweet tool with format 'REPLY:${tweetId}:@${authorUsername} yourResponse'`
            ),
          ],
        },
        this.agentConfig
      );

      for await (const chunk of stream) {
        if ("agent" in chunk) {
          console.log("Agent response:", chunk.agent.messages[0].content);
        } else if ("tools" in chunk) {
          console.log("Tool execution:", chunk.tools.messages[0].content);
        }
      }
    } catch (error) {
      console.error("Error handling tweet:", error);
    }
  }

  private async generateAutonomousAction(): Promise<string> {
    // Weight the prompts - higher numbers mean more frequent selection
    const weightedPrompts = [
      // Informative content (weight: 4)
      {
        prompt:
          "Share an interesting fact or insight about Base blockchain or Layer 2 solutions",
        weight: 4,
      },
      {
        prompt: "Discuss a recent development or trend in the crypto ecosystem",
        weight: 4,
      },
      {
        prompt: "Explain a basic crypto concept in a simple, engaging way",
        weight: 4,
      },
      {
        prompt: "Share tips about web3 development or using CDP tools",
        weight: 4,
      },

      // Community engagement (weight: 3)
      {
        prompt: "Start a discussion about the future of DeFi or NFTs",
        weight: 3,
      },
      {
        prompt: "Ask the community about their favorite web3 tools or projects",
        weight: 3,
      },
      {
        prompt: "Share an interesting use case of blockchain technology",
        weight: 3,
      },
      { prompt: "Highlight a cool feature of Base or CDP", weight: 3 },

      // Project updates (weight: 2)
      { prompt: "Share what you can do as an AI agent on Base", weight: 2 },
      { prompt: "Explain one of your capabilities or tools", weight: 2 },
      { prompt: "Share a success story or interesting interaction", weight: 2 },

      // Rare on-chain actions (weight: 1)
      {
        prompt: "Deploy a creative meme token with an interesting concept",
        weight: 1,
      },
      {
        prompt: "Create an NFT collection about current crypto trends",
        weight: 1,
      },
    ];

    // Calculate total weight
    const totalWeight = weightedPrompts.reduce(
      (sum, item) => sum + item.weight,
      0
    );

    // Generate random number between 0 and total weight
    let random = Math.random() * totalWeight;

    // Find the selected prompt based on weights
    for (const { prompt, weight } of weightedPrompts) {
      random -= weight;
      if (random <= 0) {
        return prompt;
      }
    }

    // Fallback to first prompt (should never happen)
    return weightedPrompts[0].prompt;
  }

  async runAutonomousMode(interval = 3600) {
    while (true) {
      try {
        const thought = await this.generateAutonomousAction();

        const stream = await this.agent.stream(
          {
            messages: [
              new HumanMessage(
                `Create an engaging tweet based on this prompt: ${thought}\n\n` +
                  `Guidelines:\n` +
                  `- Focus on providing value through information and engagement\n` +
                  `- Only perform on-chain actions if explicitly prompted\n` +
                  `- Keep tweets concise and friendly\n` +
                  `- Use emojis appropriately\n` +
                  `- Include hashtags like #Base #Web3 when relevant\n` +
                  `When ready, use the send_tweet tool to share your message.`
              ),
            ],
          },
          this.agentConfig
        );

        for await (const chunk of stream) {
          if ("agent" in chunk) {
            console.log("Autonomous action:", chunk.agent.messages[0].content);
          } else if ("tools" in chunk) {
            console.log("Tool execution:", chunk.tools.messages[0].content);
          }
        }

        await new Promise((resolve) => setTimeout(resolve, interval * 1000));
      } catch (error) {
        console.error("Error in autonomous mode:", error);
        await new Promise((resolve) => setTimeout(resolve, 60 * 1000));
      }
    }
  }

  private async checkMentions() {
    try {
      // Get recent mentions using search API
      const mentions = await this.twitterClient.v2.userMentionTimeline(
        process.env.TWITTER_USER_ID!, // Your bot's user ID
        {
          "tweet.fields": ["author_id", "referenced_tweets"],
          expansions: ["author_id"],
          max_results: 10,
          ...(this.lastProcessedMentionId && {
            since_id: this.lastProcessedMentionId,
          }),
        }
      );

      // console.log("Mentions:", mentions);

      // Check if mentions exists and has tweets
      if (mentions && Array.isArray(mentions.tweets)) {
        for (const tweet of mentions.tweets) {
          // Skip if it's a retweet
          const isRetweet = tweet.referenced_tweets?.some(
            (ref: { type: string }) => ref.type === "retweet"
          );
          if (isRetweet) continue;

          const author = mentions.includes?.users?.find(
            (user: { id: string }) => user.id === tweet.author_id
          );

          if (author) {
            // Pass tweet ID to handleTweet
            await this.handleTweet(tweet.text, author.username, tweet.id);
            // Add small delay between processing mentions to avoid rate limits
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      }
    } catch (error) {
      console.error("Error checking mentions:", error);
    }
  }

  // Replace startListening with pollMentions
  async pollMentions(interval = 1200) {
    // Check every 20 minutes
    console.log("Started polling for mentions...");

    while (true) {
      await this.checkMentions();
      await new Promise((resolve) => setTimeout(resolve, interval * 1000));
    }
  }
}
