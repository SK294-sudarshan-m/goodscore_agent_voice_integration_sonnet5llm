import { Container, getContainer } from "@cloudflare/containers";
import { env } from "cloudflare:workers";

export class VoiceContainer extends Container {
  defaultPort = 8090;
  // Voice calls are long-lived WebSocket connections, not quick request/
  // response — keep the container warm longer than the default so an
  // idle gap between turns mid-call doesn't tear it down.
  sleepAfter = "30m";
  envVars = {
    OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
    OPENROUTER_BASE_URL: env.OPENROUTER_BASE_URL,
    OPENROUTER_STT_MODEL: env.OPENROUTER_STT_MODEL,
    OPENROUTER_TTS_MODEL: env.OPENROUTER_TTS_MODEL,
    OPENROUTER_TTS_VOICE: env.OPENROUTER_TTS_VOICE,
    OPENROUTER_TTS_RESPONSE_FORMAT: env.OPENROUTER_TTS_RESPONSE_FORMAT,
    CHATBOT_MODE: env.CHATBOT_MODE,
    CHATBOT_LOCAL_BASE_URL: env.CHATBOT_LOCAL_BASE_URL,
    GOODSCORE_API_BASE_URL: env.GOODSCORE_API_BASE_URL,
    VOICE_SUPPORTED_LANGUAGES: env.VOICE_SUPPORTED_LANGUAGES,
    VOICE_DEFAULT_LANGUAGE: env.VOICE_DEFAULT_LANGUAGE,
    VOICE_LANGUAGE_SELECTION_MODE: env.VOICE_LANGUAGE_SELECTION_MODE,
    TOKEN_USAGE_LOG_DIR: env.TOKEN_USAGE_LOG_DIR,
  };
}

export default {
  async fetch(request, env) {
    // Same container instance for every request, including the
    // WebSocket upgrade — a voice call is one persistent connection,
    // not several requests that need to find each other.
    const container = getContainer(env.VOICE_CONTAINER, "default");
    return container.fetch(request);
  },
};
