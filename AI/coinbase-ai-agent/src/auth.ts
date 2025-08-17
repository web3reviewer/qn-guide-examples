import { TwitterApi } from 'twitter-api-v2';
import * as dotenv from 'dotenv';
import * as readline from 'readline';

dotenv.config();

const client = new TwitterApi({
  clientId: process.env.TWITTER_CLIENT_ID!,
  clientSecret: process.env.TWITTER_CLIENT_SECRET!,
});

const redirectUri = 'http://localhost:3000/callback';

async function main() {
  // Step 1: Generate auth link
  const { url, codeVerifier, state } = client.generateOAuth2AuthLink(
    redirectUri,
    { scope: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'] }
  );

  console.log('Go to:', url);

  // Step 2: Get code from callback URL
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const code = await new Promise<string>(resolve => {
    rl.question('Paste the code from the callback URL: ', resolve);
  });

  rl.close();

  // Step 3: Get access token
  const { client: loggedClient, accessToken, refreshToken, expiresIn } =
    await client.loginWithOAuth2({ code, codeVerifier, redirectUri });

  console.log('Access Token:', accessToken);
  console.log('Refresh Token:', refreshToken);
  console.log('Expires In:', expiresIn);

  // From now on, you can use loggedClient to call API on behalf of the user
  try {
    await loggedClient.v2.tweet("Hello from my app!");
    console.log("Tweeted successfully!");
  } catch (e) {
    console.error("Failed to tweet:", e);
  }
}

main();
