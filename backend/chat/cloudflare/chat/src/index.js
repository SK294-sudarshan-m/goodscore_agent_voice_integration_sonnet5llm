import { Container, getContainer } from "@cloudflare/containers";
import { env } from "cloudflare:workers";

export class ChatContainer extends Container {
  defaultPort = 8000;
  sleepAfter = "10m";
  envVars = {
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL_ID: env.ANTHROPIC_MODEL_ID,
    GOODSCORE_STAGE_BASE_URL: env.GOODSCORE_STAGE_BASE_URL,
    EXTRA_CORS_ORIGIN: env.EXTRA_CORS_ORIGIN,
  };
}

export default {
  async fetch(request, env) {
    const container = getContainer(env.CHAT_CONTAINER, "default");
    return container.fetch(request);
  },
};
