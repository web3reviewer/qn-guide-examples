import { TwitterApi } from "twitter-api-v2";
import * as fs from "fs";
// import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import * as dotenv from "dotenv";

dotenv.config();

async function testTwitterIntegration() {
  // Initialize Twitter client for OAuth 2.0
  const appClient = new TwitterApi({
    clientId: process.env.TWITTER_CLIENT_ID!,
    clientSecret: process.env.TWITTER_CLIENT_SECRET!,
  });

  // Authenticate with Twitter using the OAuth 2.0 refresh token
  console.log("Authenticating with Twitter for tests...");
  const { client, accessToken, refreshToken: newRefreshToken } = await appClient.refreshOAuth2Token(process.env.TWITTER_REFRESH_TOKEN!);
  console.log("Twitter authentication successful.");

  if (newRefreshToken) {
    console.log("A new Refresh Token was issued during tests. Updating .env file...");
    try {
      const envPath = '.env';
      let envFileContent = fs.readFileSync(envPath, 'utf8');
      if (envFileContent.includes('TWITTER_REFRESH_TOKEN')) {
        envFileContent = envFileContent.replace(
          /^TWITTER_REFRESH_TOKEN=.*$/m,
          `TWITTER_REFRESH_TOKEN=${newRefreshToken}`
        );
      } else {
        envFileContent += `\nTWITTER_REFRESH_TOKEN=${newRefreshToken}`;
      }
      fs.writeFileSync(envPath, envFileContent);
      console.log(".env file updated successfully.");
    } catch (error) {
      console.error("Error updating .env file during tests:", error);
      console.log("Please update the TWITTER_REFRESH_TOKEN in your .env file manually with:", newRefreshToken);
    }
  }

//   const llm = new ChatAnthropic({
//     anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
//     modelName: "claude-3-opus-20240229",
//   });

  const llm = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY!,
    modelName: "gpt-4o-mini",
  });

  try {
    // Test 1: Post a tweet
    console.log("Testing tweet posting...");
    const tweet = await client.v2.tweet(
      "Hello from Base AI Agent! 🤖 #TestTweet"
    );
    console.log("Tweet posted:", tweet.data.id);

    // Test 2: Get recent mentions
    console.log("\nTesting mentions retrieval...");
    const mentions = await client.v2.userMentionTimeline(
      process.env.TWITTER_USER_ID!
    );
    console.log("Recent mentions:", mentions.data);

    console.log("\nAll tests passed!");
  } catch (error) {
    console.error("Test failed:", error);
  }
}

testTwitterIntegration().catch(console.error);
