/**
 * Poller Entry Point
 *
 * Separate entry file for ESM compatibility.
 * The require.main === module pattern doesn't work with ncc ESM bundling,
 * so we use a dedicated entry file that unconditionally calls main().
 *
 * Built as: dist/poller/index.js
 */
export {};
