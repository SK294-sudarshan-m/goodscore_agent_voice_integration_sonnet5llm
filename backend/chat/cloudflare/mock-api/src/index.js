import { Container, getContainer } from "@cloudflare/containers";

export class MockApiContainer extends Container {
  defaultPort = 8001;
  sleepAfter = "10m";
}

export default {
  async fetch(request, env) {
    const container = getContainer(env.MOCK_API_CONTAINER, "default");
    return container.fetch(request);
  },
};
