/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * jsdom for client-component tests that need timers and DOM events (A5). The shared
 * setup files import lib/prisma (pg), which needs TextEncoder/TextDecoder; jsdom does
 * not provide them, so they come from Node here.
 */
const { TextDecoder, TextEncoder } = require("util");
const JsdomEnvironment = require("jest-environment-jsdom").TestEnvironment;

class JsdomWithEncoding extends JsdomEnvironment {
  async setup() {
    await super.setup();
    this.global.TextEncoder = TextEncoder;
    this.global.TextDecoder = TextDecoder;
  }
}

module.exports = JsdomWithEncoding;
